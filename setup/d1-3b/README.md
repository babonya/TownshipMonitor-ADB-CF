# Local D1 image decision model

Installed for Township image comparison. This is a standalone local inference service; it is not connected to game controls.

- Model: LiquidAI/d1-3B-GGUF, Q8_0.
- Vision projector: mmproj-d1-3B-F16.gguf.
- Runtime: llama.cpp b11503, Windows x64 CUDA 12.4.
- Model revision and download SHA-256 values: `install-manifest.json`.
- API: `http://127.0.0.1:8087/v1/systemone`.
- English instructions, two image inputs, named product-match choices.
- One inference slot, 4096-token context, GPU model and projector.

## Start and stop

Double-click `start.cmd` to start the local service in the background, or `stop.cmd` to stop it and release GPU memory. Starting an already healthy instance reuses it. There is no Windows startup registration or global PATH change.

PowerShell:

```powershell
& "$env:LOCALAPPDATA\TownshipAI\d1-3b\start.cmd"
Invoke-RestMethod http://127.0.0.1:8087/health
& "$env:LOCALAPPDATA\TownshipAI\d1-3b\stop.cmd"
```

## Compare two existing images

```powershell
py -3.12 "$env:LOCALAPPDATA\TownshipAI\d1-3b\Compare-Images.py" "C:\path\order-item.png" "C:\path\market-item.png"
```

The client uses only the Python standard library. Add `--output result.json` to save the response, source paths, hashes, and request duration. The client sends images only to the configured endpoint (localhost by default) and does not click, purchase, register products, or change source images.

Results are `same_product`, `different_product`, or `uncertain`, with model probabilities. These probabilities are not validated purchase thresholds. Use actual game captures to evaluate same-product images across helicopter/market screens and visually similar different products before enabling purchases. Installation smoke checks establish that image inference works; they do not establish production accuracy.

Only local connections are accepted. Inspect `server-process.json` for the current process and log paths. Logs are stored under `logs`. If port 8087 is occupied, use `Start-D1.ps1 -Port 8088` and pass the matching `--url` to the client.

## Sources and licenses

- [Official model](https://huggingface.co/LiquidAI/d1-3B)
- [Official GGUF weights](https://huggingface.co/LiquidAI/d1-3B-GGUF)
- [Pinned runtime release](https://github.com/ggml-org/llama.cpp/releases/tag/b11503)
- Model terms: `MODEL-LICENSE.txt` (LFM Open License).
- Runtime terms: `RUNTIME-LICENSE.txt` (MIT).

The model and projector files total 3,728,774,976 bytes. Runtime GPU memory is additional and depends on input size and context settings.
