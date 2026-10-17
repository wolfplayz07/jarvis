# Third-party runtime

- Transformers.js 4.3.1 by Hugging Face (Apache-2.0) is loaded from jsDelivr, pinned to that version, and cached by the service worker. https://github.com/huggingface/transformers.js
- `ort-wasm-simd-threaded.asyncify.mjs` and `.wasm`: ONNX Runtime Web 1.31.0-dev.20260914-8d85527a0 by Microsoft, MIT license. https://github.com/microsoft/onnxruntime

Jarvis uses these only for the on-device speech engine (`stt-worker.js`), with the WASM backend and 1 thread.
