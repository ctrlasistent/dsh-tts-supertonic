# dsh-tts-supertonic

`dsh-tts-supertonic` is a plugin for `deepseek-harness` that converts assistant replies into speech using the Supertonic 3 ONNX model. Text is never sent to the cloud; everything is processed locally on your device.

---

## Installation

```pip install supertonic numpy onnxruntime```


## Configuration

All options are set in `cordis.patch.yml`:

| Option | Type | Default | Description |
|---|---|---|---|
| `pythonPath` | `string` | `python3` (`python` on Windows) | Path to the Python interpreter. |
| `runtimePath` | `string` | `<plugin>/runtime/worker.py` | Path to `worker.py`. An empty value uses the bundled file. |
| `modelPath` | `string` | `''` | Path to a local Supertonic 3 model. An empty value triggers an automatic download. |
| `voice` | `string` | `F1` | Voice. |
| `language` | `string` | `hr` | Speech language (ISO code, e.g. `hr`, `en`, or `de`). |
| `enabled` | `boolean` | `true` | If `false`, routes return status `403` and the worker is not started. |
| `timeoutMs` | `number` | `120000` | Maximum duration of a single synthesis request. |
| `startupTimeoutMs` | `number` | `180000` | Maximum time to wait for the worker to become ready. |
| `maxTextLength` | `number` | `5000` | Maximum text length per request, in characters. |


## Model and cache

The Supertonic 3 model is not included with the plugin. It is downloaded automatically the first time the plugin runs. The download is approximately 400 MB (ONNX files and built-in voices).

### Where is it stored?

By default, the model is stored in the user’s cache directory:

**Linux**
```text
~/.cache/supertonic3/
```
**Windows**
```text
C:\Users\<user>\.cache\supertonic3\
```

