// Browser runtime for the on-device vision check: MobileCLIP-S0 through transformers.js.
//
// MobileCLIP-S0 is about 66 MB here (the earlier CLIP model was 154 MB): the image half in 16-bit
// (23 MB) and the text half in 8-bit (43 MB). In tests, 8-bit compression of the image half cost a lot of
// accuracy, so it stays 16-bit. It is downloaded the first time it is needed and cached by the browser. Text embeddings are cached in IndexedDB so repeated tasks cost nothing. The photo never
// leaves the device.
import { normalize } from './ai-vision.js';

const LIBRARY = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2';
export const VISION_MODEL = 'Xenova/mobileclip_s0';
const IMAGE_DTYPE = 'fp16', TEXT_DTYPE = 'q8';
const DB_NAME = 'daymark-vision', STORE = 'text-embeddings';

let runtimePromise = null;
const listeners = new Set();
let lastProgress = 0;

/** True when the model is ready to use right now. */
export const runtimeReady = () => Boolean(runtimePromise?.ready);

function openDb() {
  return new Promise(resolve => {
    try { const request = indexedDB.open(DB_NAME, 1); request.onupgradeneeded = () => request.result.createObjectStore(STORE); request.onsuccess = () => resolve(request.result); request.onerror = () => resolve(null); } catch { resolve(null); }
  });
}
const idb = (db, mode, run) => new Promise(resolve => { if (!db) return resolve(null); try { const request = run(db.transaction(STORE, mode).objectStore(STORE)); request.onsuccess = () => resolve(request.result ?? null); request.onerror = () => resolve(null); } catch { resolve(null); } });

async function build(onProgress) {
  const T = await import(/* webpackIgnore: true */ LIBRARY);
  T.env.allowLocalModels = false;
  const files = new Map(), report = event => {
    if (event.status === 'progress' && event.file) { files.set(event.file, event.progress || 0); const values = [...files.values()]; lastProgress = Math.min(99, Math.round(values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1))); listeners.forEach(listener => listener(lastProgress)); }
  };
  const [tokenizer, textModel, processor, visionModel, db] = await Promise.all([
    T.AutoTokenizer.from_pretrained(VISION_MODEL, { progress_callback: report }),
    T.CLIPTextModelWithProjection.from_pretrained(VISION_MODEL, { dtype: TEXT_DTYPE, progress_callback: report }),
    T.AutoProcessor.from_pretrained(VISION_MODEL, { progress_callback: report }),
    T.CLIPVisionModelWithProjection.from_pretrained(VISION_MODEL, { dtype: IMAGE_DTYPE, progress_callback: report }),
    openDb()
  ]);

  async function embedTexts(prompts) {
    const cached = await Promise.all(prompts.map(prompt => idb(db, 'readonly', store => store.get(`${VISION_MODEL}|${prompt}`))));
    const missing = [...new Set(prompts.filter((_, index) => !cached[index]))], fresh = new Map();
    if (missing.length) {
      const inputs = tokenizer(missing, { padding: 'max_length', truncation: true }), { text_embeds } = await textModel(inputs), rows = text_embeds.normalize().tolist();
      missing.forEach((prompt, index) => { fresh.set(prompt, rows[index]); if (db) try { db.transaction(STORE, 'readwrite').objectStore(STORE).put(rows[index], `${VISION_MODEL}|${prompt}`); } catch { /* cache is optional */ } });
    }
    return prompts.map((prompt, index) => cached[index] || fresh.get(prompt));
  }

  /** Average the embedding of up to three square views so edges are not lost to the centre crop. */
  async function embedImage(imageUrl) {
    const image = await T.RawImage.read(imageUrl), { width, height } = image, views = [image];
    if (Math.max(width, height) / Math.min(width, height) > 1.2) {
      const side = Math.min(width, height), at = (x, y) => image.crop([x, y, x + side - 1, y + side - 1]);
      views.length = 0;
      if (width >= height) views.push(await at(0, 0), await at(Math.floor((width - side) / 2), 0), await at(width - side, 0)); else views.push(await at(0, 0), await at(0, Math.floor((height - side) / 2)), await at(0, height - side));
    }
    const vectors = [];
    for (const view of views) { const { image_embeds } = await visionModel(await processor(view)); vectors.push(image_embeds.normalize().tolist()[0]); }
    return normalize(vectors[0].map((_, index) => vectors.reduce((sum, vector) => sum + vector[index], 0) / vectors.length));
  }
  return { embedTexts, embedImage };
}

/** Load the model once. onProgress receives 0..100 (also for later callers while the download runs). */
export function loadRuntime(onProgress = () => {}) {
  if (onProgress) { listeners.add(onProgress); if (lastProgress) onProgress(lastProgress); }
  if (!runtimePromise) {
    runtimePromise = build().then(runtime => { runtimePromise.ready = true; listeners.forEach(listener => listener(100)); return runtime; });
    runtimePromise.catch(() => { runtimePromise = null; lastProgress = 0; }); // allow a retry after a network failure
  }
  return runtimePromise;
}
