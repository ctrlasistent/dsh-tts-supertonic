#!/usr/bin/env python3

"""
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
"""

"""
dsh-tts-supertonic runtime: a persistent Supertonic 3 worker driven over stdio.

The Host half (lib/index.js) spawns this file once and keeps it alive; every
assistant reply is one JSON line in, one JSON line out. Loading the ONNX models
costs a few seconds, so doing it once per session instead of once per sentence is
the whole point of this design.

Protocol — stdout carries NOTHING but protocol lines, one JSON object per line:

    <- {"ready": true, "voice": "F1", "language": "hr", "sampleRate": 44100}
    -> {"id": 1, "text": "Dobar dan!"}
    <- {"ok": true, "id": 1, "audio": "<base64 16-bit PCM WAV>", "duration": 1.42}
    <- {"ok": false, "id": 1, "error": "..."}

Everything else (library progress bars, warnings, tracebacks) goes to stderr,
which the Host forwards to its own log.

argv: <modelDir> <voice> <language>

Requires: pip install supertonic numpy
"""

import base64
import io
import json
import sys
import traceback
import wave

import numpy as np

SAMPLE_RATE = 44100

# Reserve the real stdout for the protocol BEFORE importing the engine: the
# Supertonic/Hugging Face stack likes to print banners and progress bars, and a
# single stray line on stdout would desynchronise the Host's line reader.
_PROTOCOL = sys.stdout
sys.stdout = sys.stderr

from supertonic import TTS  # noqa: E402  (must come after the stdout swap)


def send(payload):
    _PROTOCOL.write(json.dumps(payload) + "\n")
    _PROTOCOL.flush()


def log(message):
    print(f"[supertonic] {message}", file=sys.stderr, flush=True)


def encode_wav(audio):
    """Float samples in [-1, 1] -> mono 16-bit PCM WAV bytes (stdlib only)."""
    clipped = np.clip(audio, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(pcm.tobytes())
    return buffer.getvalue()


def load_engine(model_dir):
    """Build the engine, tolerating SDK versions without the model_dir kwargs."""
    options = {
        "model": "supertonic-3",
        "auto_download": model_dir == "",
        "intra_op_num_threads": 4,
        "inter_op_num_threads": 1,
    }
    if model_dir != "":
        options["model_dir"] = model_dir
    try:
        return TTS(**options)
    except TypeError as error:
        log(
            f"SDK rejected the explicit options ({error}); falling back to TTS(auto_download=True)"
        )
        return TTS(auto_download=True)


def main():
    model_dir = sys.argv[1].strip() if len(sys.argv) > 1 else ""
    voice = sys.argv[2].strip() if len(sys.argv) > 2 else "F1"
    language = sys.argv[3].strip() if len(sys.argv) > 3 else "hr"

    log(
        f"loading Supertonic 3 (voice={voice}, language={language}, model_dir={model_dir or '<auto>'})"
    )
    tts = load_engine(model_dir)
    style = tts.get_voice_style(voice_name=voice)
    log("ready")

    send(
        {"ready": True, "voice": voice, "language": language, "sampleRate": SAMPLE_RATE}
    )

    try:
        for line in sys.stdin:
            line = line.strip()
            if line == "":
                continue

            request_id = None
            try:
                request = json.loads(line)
                request_id = request.get("id")
                text = str(request.get("text", "")).strip()
                if text == "":
                    raise ValueError("empty text")

                options = {"text": text, "voice_style": style, "lang": language}
                try:
                    wav, duration = tts.synthesize(total_steps=8, speed=1.0, **options)
                except TypeError:
                    wav, duration = tts.synthesize(**options)

                audio = np.asarray(wav, dtype=np.float32).squeeze()
                if audio.ndim != 1:
                    raise ValueError(f"unexpected audio shape: {audio.shape}")

                send(
                    {
                        "ok": True,
                        "id": request_id,
                        "audio": base64.b64encode(encode_wav(audio)).decode("ascii"),
                        "duration": float(np.asarray(duration).sum()),
                    }
                )
            except (
                Exception
            ) as error:  # noqa: BLE001 - one bad request must not kill the worker
                log(traceback.format_exc())
                send({"ok": False, "id": request_id, "error": str(error)})
    except KeyboardInterrupt:
        # Ctrl+C must be caught so the Host can close the stream gracefully
        # instead of being left hanging on a half-open pipe.
        log("interrupted with Ctrl+C")
        send({"ok": False, "id": None, "error": "interrupted by Ctrl+C"})


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
        sys.exit(1)
