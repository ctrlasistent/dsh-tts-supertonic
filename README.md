`dsh-tts-supertonic` is a plugin for `deepseek-harness` that converts assistant replies 
into speech using the Supertonic 3 ONNX model.  Text is never sent to the cloud; everything is processed locally on your device. 

**Requirements**

- Python >=3.13, 64-bit  
- Python packages `supertonic`, `numpy`, `onnxruntime`  
- Supertonic 3 model, \~400 MB (downloaded automatically on first run)  

**Windows** 

install Python from ((https://www.python.org) and tick **"Add python.exe to PATH"** in the installer. 
Do not use the Microsoft Store Python. If you already have it, disable it under *Settings -> Apps -> Advanced app settings -> App execution aliases*, or set `pythonPath` to a real interpreter (see Configuration).  

```  
python --version   
python -m pip install supertonic numpy onnxruntime   
python -c "import supertonic, numpy, onnxruntime; print('ok')"  
```  

**Debian GNU/Linux**

Since Debian 12, `pip install` refuses to install packages into the system Python environment (PEP 668, externally managed environment). Therefore, use a virtual environment as shown below.

If absolutely necessary, you can bypass this restriction using:
```pip install supertonic numpy onnxruntime --break-system-packages```  
**Note**: Using `--break-system-packages` is **not** recommended, as it may interfere with system-managed Python package

Recommended approach:
```  
sudo apt update
sudo apt install python3 python3-venv
python3 -m venv ~/.dsh-tts-venv
~/.dsh-tts-venv/bin/python -m pip install supertonic numpy onnxruntime
~/.dsh-tts-venv/bin/python -c "import supertonic, numpy, onnxruntime; print('ok')"
 
```  
If the self-test prints `ok`, the environment is ready. 

On Linux, configure the plugin to use the virtual environment's Python interpreter by setting pythonPath in `cordis.patch.yml`:  
```  
dsh-tts-supertonic:  
    pythonPath: "/home/<user>/.dsh-tts-venv/bin/python"
```  
**Configuration**  

All options are set in `cordis.patch.yml`:  
  
|  |  |  |  |  
| - | - | - | - |  
|  |   |   |   |  
| **Option** |  **Type** |  **Default** |  **Description** |  
| `pythonPath` |  string |  `python3` (`python` on Windows) |  Path to the Python interpreter. Set a full path if `python` does not resolve to a real interpreter. |  
| `runtimePath` |  string |  `<plugin>/runtime/worker.py` |  Path to `worker.py`. An empty value uses the bundled file. |  
| `modelPath` |  string |  `''` |  Path to a local Supertonic 3 model. An empty value triggers an automatic download. |  
| `voice` |  string |  `F1` |  Voice. |  
| `language` |  string |  `hr` |  Speech language (ISO code, e.g. `hr`, `en`, `de`). Supertonic 3 supports 31 languages. |  
| `enabled` |  boolean |  `true` |  If `false`, routes return status `403` and the worker is not started. |  
| `timeoutMs` |  number |  `120000` |  Maximum duration of a single synthesis request. |  
| `startupTimeoutMs` |  number |  `180000` |  Maximum time to wait for the worker to become ready. |  
| `maxTextLength` |  number |  `5000` |  Maximum text length per request, in characters. |  
  
  
**Model and cache**  
  
The Supertonic 3 model is not included with the plugin. It is downloaded automatically on first run (\~400 MB) and stored in the user cache directory:  
- Linux: `~/.cache/supertonic3/`  
- Windows: `C:\Users\<user>\.cache\supertonic3\`  
  
If the first startup times out while the model is still downloading, raise `startupTimeoutMs` (e.g. `600000`).  


https://github.com/ctrlasistent/dsh-tts-supertonic
