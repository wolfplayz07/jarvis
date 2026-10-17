/* Jarvis Phone - on-device speech to text (Whisper tiny.en, WASM). Runs in a module worker.
   Model and runtime are served from this site (models/, vendor/) and cached; no audio leaves the phone. */
// Transformers.js comes from jsDelivr (pinned version), cached by the service worker after the first
// load. (The self-hosted copy was rejected by GitHub push protection: a model class name in it looks like an API key.)
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';

const here = new URL('./', self.location.href).href;
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('./models/', self.location.href).pathname; // a path, not a full URL: transformers.js only checks local files for paths
env.useBrowserCache = false; // the service worker caches the files instead
env.backends.onnx.wasm.wasmPaths = here + 'vendor/';
env.backends.onnx.wasm.numThreads = 1; // no SharedArrayBuffer on GitHub Pages; also gentler on iPhone memory
env.backends.onnx.wasm.proxy = false;

let asr = null;
function load() {
  if (!asr) {
    asr = pipeline('automatic-speech-recognition', 'whisper-tiny.en', {
      device: 'wasm', dtype: 'q8',
      progress_callback: (p) => self.postMessage({ type: 'progress', p: { status: p.status, file: p.file, loaded: p.loaded, total: p.total } })
    }).then((pipe) => { self.postMessage({ type: 'ready' }); return pipe; })
      .catch((e) => { asr = null; throw e; });
  }
  return asr;
}

self.onmessage = async (e) => {
  const m = e.data || {};
  try {
    if (m.type === 'load') { await load(); return; }
    if (m.type === 'transcribe') {
      const pipe = await load();
      const t0 = Date.now();
      const out = await pipe(m.audio);
      self.postMessage({ type: 'text', id: m.id, text: (out && out.text) || '', ms: Date.now() - t0 });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, error: String((err && err.message) || err) });
  }
};
