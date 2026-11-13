/*
MIT License

Copyright (c) 2026 Contributors to the dsh-tts-supertonic project

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

/**
dsh-tts-supertonic host half: local Supertonic 3 synthesis served over the Host webServer.
The browser client half (client.js) posts assistant text to `POST /dsh-tts-supertonic/speak`
and receives a WAV buffer it plays locally. Supertonic runs as a persistent child process
of the Host — no extra server, no API keys, nothing leaves the machine.
*/

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

export const name = 'dsh-tts-supertonic'
export const inject = ['webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = resolve(HERE, '..')
const DEFAULT_RUNTIME = resolve(PLUGIN_ROOT, 'runtime', 'worker.py')

export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const number = (value, fallback, minimum) => {
    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback
  }
  const text = (value, fallback) => typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
  return {
    pythonPath: text(source.pythonPath, process.platform === 'win32' ? 'python' : 'python3'),
    runtimePath: text(source.runtimePath, DEFAULT_RUNTIME),
    modelPath: typeof source.modelPath === 'string' ? source.modelPath.trim() : '',
    voice: text(source.voice, 'F1'),
    language: text(source.language, 'hr'),
    enabled: source.enabled !== false,
    timeoutMs: number(source.timeoutMs, 120_000, 1000),
    startupTimeoutMs: number(source.startupTimeoutMs, 180_000, 1000),
    maxTextLength: number(source.maxTextLength, 5000, 1),
  }
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let received = 0
    req.on('data', (chunk) => {
      received += chunk.length
      if (received > limitBytes) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function respondJson(res, status, payload) {
  if (res.writableEnded) return
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function respondWav(res, wav) {
  if (res.writableEnded) return
  res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length, 'Cache-Control': 'no-store' })
  res.end(wav)
}

class SupertonicWorker {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    this.child = null
    this.rl = null
    this.pending = new Map()
    this.nextId = 1
    this.ready = false
    this.readyPromise = null
    this.readyResolve = null
    this.readyReject = null
    this.started = false
    this.shuttingDown = false
    this.restartTimer = null
  }

  start() {
    if (this.started || this.shuttingDown) return
    this.started = true
    this._spawn()
  }

  _spawn() {
    const { pythonPath, runtimePath, modelPath, voice, language } = this.config
    this.ctx.logger.info(`[dsh-tts-supertonic] spawning worker: ${pythonPath} ${runtimePath}`)
    
    const args = [runtimePath, modelPath, voice, language]
    this.child = spawn(pythonPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    this.rl = createInterface({ input: this.child.stdout })
    
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })

    const startupTimer = setTimeout(() => {
      if (!this.ready) {
        this.ctx.logger.error(`[dsh-tts-supertonic] worker startup timed out after ${this.config.startupTimeoutMs}ms`)
        if (this.child) this.child.kill('SIGKILL')
      }
    }, this.config.startupTimeoutMs)

    this.rl.on('line', (line) => {
      if (!line) return
      try {
        const msg = JSON.parse(line)
        if (msg.ready) {
          this.ready = true
          this.ctx.logger.info(`[dsh-tts-supertonic] worker ready (voice=${msg.voice}, lang=${msg.language})`)
          clearTimeout(startupTimer)
          if (this.readyResolve) {
            this.readyResolve()
            this.readyResolve = null
          }
        } else if (msg.id !== undefined && msg.id !== null) {
          const pending = this.pending.get(msg.id)
          if (pending) {
            this.pending.delete(msg.id)
            clearTimeout(pending.timer)
            if (msg.ok) {
              pending.resolve(Buffer.from(msg.audio, 'base64'))
            } else {
              pending.reject(new Error(msg.error || 'Unknown synthesis error'))
            }
          }
        }
      } catch (err) {
        this.ctx.logger.warn(`[dsh-tts-supertonic] failed to parse worker stdout: ${line}`)
      }
    })

    this.child.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim()
      if (text) {
        this.ctx.logger.info(`[dsh-tts-supertonic:stderr] ${text}`)
      }
    })

    this.child.on('error', (err) => {
      this.ctx.logger.error(`[dsh-tts-supertonic] worker spawn error: ${err.message}`)
      clearTimeout(startupTimer)
      if (this.readyReject) {
         this.readyReject(err)
         this.readyReject = null
      }
      this._failAll(err)
      this.started = false
      this.ready = false
    })

    this.child.on('exit', (code, signal) => {
      this.ctx.logger.warn(`[dsh-tts-supertonic] worker exited (code=${code}, signal=${signal})`)
      clearTimeout(startupTimer)
      if (!this.ready && this.readyReject) {
         this.readyReject(new Error(`Worker exited before becoming ready (code=${code})`))
         this.readyReject = null
      }
      this._failAll(new Error('Worker exited unexpectedly'))
      this.started = false
      this.ready = false
      
      if (!this.shuttingDown) {
        this.restartTimer = setTimeout(() => this.start(), 2000)
      }
    })
  }

  _failAll(err) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pending.clear()
  }

  async synthesize(text) {
    if (!this.started) this.start()
    await this.readyPromise
    
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Synthesis timed out after ${this.config.timeoutMs}ms`))
      }, this.config.timeoutMs)
      
      this.pending.set(id, { resolve, reject, timer })
      
      const payload = JSON.stringify({ id, text })
      try {
        if (!this.child || !this.child.stdin || this.child.stdin.destroyed) {
            throw new Error('Worker process is not available')
        }
        this.child.stdin.write(payload + '\n')
      } catch (err) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(err)
      }
    })
  }

  stop() {
    this.shuttingDown = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    if (this.child) {
      this.child.kill('SIGTERM')
      this.child = null
    }
    if (this.rl) {
      this.rl.close()
      this.rl = null
    }
    this._failAll(new Error('Worker stopped'))
  }
}

async function handleSpeak(ctx, worker, config, req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    respondJson(res, 405, { error: 'Use POST with a JSON body { "text": "..." }' })
    return
  }
  if (!config.enabled) {
    respondJson(res, 403, { error: 'dsh-tts-supertonic is disabled in its bundle configuration (enabled: false).' })
    return
  }
  
  let text
  try {
    const body = await readBody(req, config.maxTextLength * 8 + 4096)
    const payload = JSON.parse(body)
    text = typeof payload?.text === 'string' ? payload.text : ''
  } catch (error) {
    respondJson(res, 400, { error: `Invalid request body: ${error instanceof Error ? error.message : String(error)}` })
    return
  }
  
  text = text.replace(/\u0000/g, '').trim().slice(0, config.maxTextLength)
  if (text === '') {
    respondJson(res, 400, { error: 'The text field is empty.' })
    return
  }
  
  try {
    const wav = await worker.synthesize(text)
    respondWav(res, wav)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger.warn(`[dsh-tts-supertonic] synthesis failed: ${message}`)
    respondJson(res, 500, { error: message })
  }
}

export function apply(ctx, config) {
  const value = normalizeConfig(config)
  
  const clientState = { presence: 'unknown', rev: undefined }
  
  let worker = null
  if (value.enabled) {
    worker = new SupertonicWorker(ctx, value)
    worker.start()
  }
  
  const routes = [
    {
      kind: 'exact',
      path: '/dsh-tts-supertonic/speak',
      handler: (req, res) => { void handleSpeak(ctx, worker, value, req, res) },
    },
    {
      kind: 'exact',
      path: '/dsh-tts-supertonic/status',
      handler: (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.setHeader('Allow', 'GET')
          respondJson(res, 405, { error: 'Use GET.' })
          return
        }
        respondJson(res, 200, {
          enabled: value.enabled,
          configured: true, // Supertonic auto-downloads models if modelPath is empty
          pythonPath: value.pythonPath,
          voice: value.voice,
          language: value.language,
          clientBundle: clientState.presence,
          ...(clientState.rev === undefined ? {} : { clientRev: clientState.rev }),
        })
      },
    },
  ]
  
  const disposers = []
  const foreign = []
  for (const route of routes) {
    try {
      disposers.push(ctx.webServer.register(route))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('duplicate')) throw error
      foreign.push(route.path)
    }
  }
  
  if (foreign.length === 0) {
    ctx.logger.info(`[dsh-tts-supertonic] routes registered (/dsh-tts-supertonic/speak, /dsh-tts-supertonic/status)`)
  } else {
    ctx.logger.warn(`[dsh-tts-supertonic] ${foreign.join(' and ')} already registered by another active fiber.`)
  }
  
  ctx.inject(['clientModules'], (scope) => {
    try {
      const row = scope.clientModules.graph().entries.find((entry) => entry.id === 'dsh-tts-supertonic')
      if (row === undefined) {
        clientState.presence = 'missing'
        ctx.logger.warn('[dsh-tts-supertonic] the client bundle is NOT in the served boot graph.')
        return
      }
      clientState.presence = 'in-graph'
      clientState.rev = row.rev
      ctx.logger.info(`[dsh-tts-supertonic] client bundle is in the served boot graph (rev ${row.rev})`)
    } catch (error) {
      clientState.presence = 'unknown'
      ctx.logger.warn(`[dsh-tts-supertonic] could not read the client boot graph: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  
  return () => {
    if (worker) worker.stop()
    for (const dispose of disposers) dispose()
  }
}
