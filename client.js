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

console.info('[dsh-tts-supertonic] client bundle v1.0.0 received — factory registering')

window.__ModuleLoader__.load({
  id: 'dsh-tts-supertonic',
  factory(require) {
    const { Fragment, useState, useEffect, useRef } = require('react')
    const { jsx, jsxs } = require('react/jsx-runtime')
    const { createPortal } = require('react-dom')
    
    const STORAGE_KEY = 'dsh-tts-supertonic-auto'
    const SETTLE_DELAY_MS = 300
    const MAX_QUEUE = 3

    function SpeakerIcon({ muted }) {
      return jsx('svg', {
        width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
        children: muted
          ? jsxs(Fragment, { children: [
            jsx('path', { d: 'M11 5 6 9H2v6h4l5 4V5z' }),
            jsx('line', { x1: 22, y1: 9, x2: 16, y2: 15 }),
            jsx('line', { x1: 16, y1: 9, x2: 22, y2: 15 }),
          ] })
          : jsxs(Fragment, { children: [
            jsx('path', { d: 'M11 5 6 9H2v6h4l5 4V5z' }),
            jsx('path', { d: 'M15.54 8.46a5 5 0 0 1 0 7.07' }),
            jsx('path', { d: 'M19.07 4.93a10 10 0 0 1 0 14.14' }),
          ] }),
      })
    }

    function cleanText(raw) {
      return raw
        .replace(/```[\s\S]*?(```|$)/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, '')
        .replace(/[*_~|>]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    }

    function isSkippedElement(element) {
      if (element.getAttribute('data-variant') === 'think') return true
      if (element.hasAttribute('data-turn-process-inline')) return true
      if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return true
      const tag = element.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') return true
      if (/visuallyhidden/i.test(typeof element.className === 'string' ? element.className : '')) return true
      let style
      try { style = getComputedStyle(element) } catch { return false }
      return style.display === 'none' || style.visibility === 'hidden'
        || style.contentVisibility === 'hidden'
        || style.clipPath === 'inset(50%)'
        || /^rect\(0/.test(style.clip ?? '')
    }

    function extractText(root) {
      let out = ''
      const visit = (node) => {
        for (const child of node.childNodes) {
          if (typeof child === 'string') { out += `${child} `; continue }
          if (child.nodeType === 3) { out += `${child.nodeValue ?? ''} `; continue }
          if (child.nodeType !== 1) continue
          if (!isSkippedElement(child)) visit(child)
        }
      }
      visit(root)
      return cleanText(out)
    }

    function createApi() {
      const listeners = new Set()
      const queue = []
      const state = {
        auto: false, speaking: false, configured: undefined, lastError: null,
      }
      let current = null
      try { state.auto = window.localStorage.getItem(STORAGE_KEY) === '1' } catch { /* storage unavailable */ }
      
      const notify = () => { for (const listener of [...listeners]) listener() }
      const persist = () => { try { window.localStorage.setItem(STORAGE_KEY, state.auto ? '1' : '0') } catch { /* ignore */ } }
      
      function playUrl(url) {
        return new Promise((resolve, reject) => {
          const audio = new Audio(url)
          let settled = false
          const finish = (error) => {
            if (settled) return
            settled = true
            current = null
            try { URL.revokeObjectURL(url) } catch { /* ignore */ }
            if (error === undefined) resolve()
            else reject(error)
          }
          current = { audio, finish: () => finish() }
          audio.onended = () => finish()
          audio.onerror = () => finish(new Error('Audio playback failed'))
          audio.play().catch((error) => finish(error instanceof Error ? error : new Error(String(error))))
        })
      }
      
      async function pump() {
        if (state.speaking || !state.auto || queue.length === 0) return
        const text = queue.shift()
        state.speaking = true
        state.lastError = null
        notify()
        try {
          const response = await fetch('/dsh-tts-supertonic/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          })
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}))
            throw new Error(payload && typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`)
          }
          await playUrl(URL.createObjectURL(await response.blob()))
        } catch (error) {
          state.lastError = error instanceof Error ? error.message : String(error)
          console.error('[dsh-tts-supertonic]', state.lastError)
        } finally {
          state.speaking = false
          notify()
          if (state.auto && queue.length > 0) void pump()
        }
      }
      
      async function refreshStatus() {
        try {
          const response = await fetch('/dsh-tts-supertonic/status')
          if (!response.ok) return
          const payload = await response.json()
          state.configured = payload.configured === true
          notify()
        } catch { /* status is best-effort */ }
      }
      
      return {
        enabled: () => state.auto,
        isSpeaking: () => state.speaking,
        isConfigured: () => state.configured,
        lastError: () => state.lastError,
        refreshStatus: () => refreshStatus(),
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
        buttonClick: () => {
          if (state.speaking) {
            if (current !== null) {
              try { current.audio.pause() } catch { /* ignore */ }
              current.finish()
            }
            queue.length = 0
            return
          }
          state.auto = !state.auto
          persist()
          if (!state.auto) queue.length = 0
          void refreshStatus()
          notify()
        },
        enqueue: (text) => {
          if (!state.auto || queue.length >= MAX_QUEUE) return
          queue.push(text)
          void pump()
        },
        stop: () => {
          queue.length = 0
          if (current !== null) {
            try { current.audio.pause() } catch { /* ignore */ }
            current.finish()
          }
        },
        dispose: () => {
          queue.length = 0
          if (current !== null) {
            try { current.audio.pause() } catch { /* ignore */ }
            current.finish()
          }
          listeners.clear()
        },
      }
    }

    function installObserver(api) {
      if (typeof document === 'undefined') return () => {}
      const watching = new WeakSet()
      const pending = new Map()
      const settle = (root) => {
        pending.delete(root)
        if (!root.isConnected || !api.enabled()) return
        const text = extractText(root)
        if (text.length >= 2) api.enqueue(text)
      }
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes') {
            const root = mutation.target
            if (watching.has(root) && !root.hasAttribute('data-streaming') && !pending.has(root)) {
              pending.set(root, setTimeout(() => settle(root), SETTLE_DELAY_MS))
            }
            continue
          }
          for (const node of mutation.addedNodes) {
            if (!(node instanceof Element)) continue
            const candidates = node.matches('[data-streaming]') ? [node] : [...node.querySelectorAll('[data-streaming]')]
            const roots = candidates.filter((root) => root.tagName === 'DIV')
            for (const root of roots) {
              watching.add(root)
              const timer = pending.get(root)
              if (timer !== undefined) { clearTimeout(timer); pending.delete(root) }
            }
          }
          for (const [root, timer] of pending) {
            if (!root.isConnected) { clearTimeout(timer); pending.delete(root) }
          }
        }
      })
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-streaming'] })
      return () => {
        for (const timer of pending.values()) clearTimeout(timer)
        pending.clear()
        observer.disconnect()
      }
    }

    function findMicHost(placeholder) {
      const anchor = placeholder?.closest?.('[data-slot="conversation.input.right"]')
      if (anchor === null || anchor === undefined) return null
      const controls = anchor.parentElement
      const trailing = controls?.parentElement
      if (controls === null || controls === undefined || trailing === null || trailing === undefined || controls === trailing) return null
      const micAnchor = trailing.querySelector('[data-slot="conversation.input.activity"]')
      const micHost = micAnchor?.parentElement
      if (micHost === null || micHost === undefined) return null
      return micHost.parentElement === trailing && micHost !== controls ? micHost : null
    }

    function TtsToggle({ tts }) {
      const [, setRevision] = useState(0)
      const [hover, setHover] = useState(false)
      const anchorRef = useRef(null)
      const seatRef = useRef(null)
      const [seat, setSeat] = useState(null)
      
      useEffect(() => tts?.subscribe?.(() => setRevision((value) => value + 1)), [tts])
      useEffect(() => { tts?.refreshStatus?.() }, [tts])
      
      useEffect(() => {
        let cancelled = false
        let timer = null
        let tries = 0
        const attempt = () => {
          if (cancelled) return
          const micHost = findMicHost(anchorRef.current)
          if (micHost !== null) {
            const element = document.createElement('span')
            element.style.display = 'contents'
            micHost.after(element)
            seatRef.current = element
            setSeat(element)
            return
          }
          if (tries++ < 20) timer = setTimeout(attempt, 150)
        }
        attempt()
        return () => {
          cancelled = true
          if (timer !== null) clearTimeout(timer)
          seatRef.current?.remove()
          seatRef.current = null
        }
      }, [])
      
      const speaking = tts?.isSpeaking?.() ?? false
      const on = tts?.enabled?.() ?? false
      const configured = tts?.isConfigured?.()
      const error = tts?.lastError?.() ?? null
      
      const title = speaking ? 'dsh-tts-supertonic: speaking — click to stop'
        : error !== null ? `dsh-tts-supertonic error: ${error}`
        : configured === false ? 'dsh-tts-supertonic: Supertonic model not configured'
        : on ? 'auto-read is on'
        : 'auto-read is off'
        
      const button = jsx('button', {
        type: 'button',
        'aria-label': title,
        'aria-pressed': on,
        title,
        onClick: () => tts?.buttonClick?.(),
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          padding: 0,
          borderRadius: (on || speaking) ? '50%' : 8,
          cursor: 'pointer',
          position: 'relative',
          border: 'none',
          background: speaking
            ? (hover ? '#dc2626' : '#ef4444')
            : on
              ? 'rgba(127, 127, 127, 0.22)'
              : hover
                ? 'rgba(127, 127, 127, 0.08)'
                : 'transparent',
          color: speaking
            ? '#fff'
            : 'var(--dsh-color-text-secondary, inherit)',
          opacity: configured === false ? 0.55 : 1,
          transition: 'background 150ms ease, border-radius 150ms ease',
        },
        children: jsxs(Fragment, {
          children: [
            jsx(SpeakerIcon, { muted: !on && !speaking, size: 17 }),
            configured === false && jsx('span', {
              'aria-hidden': true,
              style: {
                position: 'absolute', top: -3, right: -3, width: 8, height: 8,
                borderRadius: 999, background: '#f59e0b', border: '1px solid rgba(0,0,0,0.2)',
              },
            }),
          ],
        }),
      });
      
      return jsxs(Fragment, { children: [
        jsx('span', { ref: anchorRef, hidden: true, 'aria-hidden': 'true', style: { display: 'none' } }),
        seat === null ? button : createPortal(button, seat),
      ] })
    }

    const inject = ['slots']
    
    function apply(ctx) {
      const api = createApi()
      ctx.effect(() => {
        void api.refreshStatus()
        const disposeSlot = ctx.slots.inject('conversation.input.right', () => {
          const disposeEntry = ctx.slots.register({
            name: 'conversation.input.right',
            id: 'dsh-tts-supertonic',
            order: 10,
            inject: () => ({ tts: api }),
          }, TtsToggle)
          console.info('[dsh-tts-supertonic] composer toggle registered into conversation.input.right')
          return disposeEntry
        })
        const disposeObserver = installObserver(api)
        return () => {
          disposeObserver()
          if (typeof disposeSlot === 'function') disposeSlot()
          api.dispose()
        }
      }, 'dsh-tts-supertonic: composer toggle and auto-read')
    }

    return { name: 'dsh-tts-supertonic', inject, apply }
  },
})
