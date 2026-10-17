# On-device speech model

`whisper-tiny.en/` is the ONNX export of OpenAI Whisper tiny.en (MIT license, https://github.com/openai/whisper),
from https://huggingface.co/onnx-community/whisper-tiny.en (8-bit quantized encoder + merged decoder, about 41 MB).
It runs entirely on the phone through `stt-worker.js`. It is downloaded once from this site and cached by the service worker.
