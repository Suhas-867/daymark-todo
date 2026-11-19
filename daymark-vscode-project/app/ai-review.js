// On-device "AI" proof checker used by demo mode.
//
// It inspects the uploaded photo itself (sharpness, contrast, exposure, resolution, colour,
// duplicate detection) and decides whether to approve it, reject it or escalate it to a human
// admin. It does NOT understand what the photo shows - a production build would send the image
// to a vision model from the backend (see functions/index.js). The user interface always
// labels demo results as an on-device check.

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export const AI_THRESHOLDS = { approve: 62, reject: 30 };

/** Derive image statistics from RGBA pixel data (e.g. canvas getImageData().data). */
export function statsFromPixels(rgba, width, height) {
  const count = width * height;
  const luma = new Float32Array(count);
  let sum = 0, rg = 0, yb = 0, rgSq = 0, ybSq = 0;
  for (let i = 0; i < count; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    luma[i] = l; sum += l;
    const a = r - g, c = 0.5 * (r + g) - b;
    rg += a; yb += c; rgSq += a * a; ybSq += c * c;
  }
  const mean = sum / count;
  let variance = 0;
  for (let i = 0; i < count; i++) variance += (luma[i] - mean) ** 2;
  const std = Math.sqrt(variance / count);

  let edge = 0, edgeSamples = 0;
  for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
    const here = luma[y * width + x];
    edge += (Math.abs(here - luma[y * width + x + 1]) + Math.abs(here - luma[(y + 1) * width + x])) / 2;
    edgeSamples++;
  }
  const edgeDensity = edgeSamples ? edge / edgeSamples / 255 : 0;

  // Hasler-Suesstrunk colourfulness, roughly 0 (grey) .. 1 (vivid).
  const rgMean = rg / count, ybMean = yb / count;
  const rgStd = Math.sqrt(Math.max(0, rgSq / count - rgMean ** 2)), ybStd = Math.sqrt(Math.max(0, ybSq / count - ybMean ** 2));
  const colorfulness = clamp((Math.sqrt(rgStd ** 2 + ybStd ** 2) + 0.3 * Math.sqrt(rgMean ** 2 + ybMean ** 2)) / 100);

  return { meanLuma: mean, stdLuma: std, edgeDensity, colorfulness, fingerprint: averageHash(luma, width, height) };
}

/** 64-bit average hash (hex) so the same photo reused for another task can be spotted. */
export function averageHash(luma, width, height) {
  const cells = new Array(64).fill(0), counts = new Array(64).fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = Math.min(7, Math.floor(y * 8 / height)) * 8 + Math.min(7, Math.floor(x * 8 / width));
    cells[cell] += luma[y * width + x]; counts[cell]++;
  }
  const averages = cells.map((total, i) => counts[i] ? total / counts[i] : 0);
  const mean = averages.reduce((a, b) => a + b, 0) / 64;
  let hex = '';
  for (let nibble = 0; nibble < 16; nibble++) {
    let value = 0;
    for (let bit = 0; bit < 4; bit++) value = (value << 1) | (averages[nibble * 4 + bit] > mean ? 1 : 0);
    hex += value.toString(16);
  }
  return hex;
}

/** Number of differing bits between two hex fingerprints (0 = identical). */
export function hashDistance(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { distance += x & 1; x >>= 1; }
  }
  return distance;
}

const words = text => String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 4);

/**
 * Decide what to do with a proof image.
 * @returns {{decision:'approve'|'needs_human'|'reject', score:number, reason:string}}
 */
export function scoreProof({ stats, width, height, taskTitle = '', fileName = '', duplicateOf = null }) {
  if (duplicateOf) return { decision: 'reject', score: 0, reason: 'This photo looks identical to proof already used for another task. Please upload a new photo.' };
  const detail = clamp(stats.edgeDensity / 0.05), contrast = clamp(stats.stdLuma / 50);
  const exposure = 1 - clamp((Math.abs(stats.meanLuma - 128) / 128 - 0.3) / 0.7);
  const resolution = clamp(Math.min(width, height) / 480), colour = clamp(stats.colorfulness / 0.22);
  const taskWords = new Set(words(taskTitle)), nameHit = words(fileName.replace(/\.[a-z0-9]+$/i, '')).some(word => taskWords.has(word));

  let score = Math.round(detail * 36 + contrast * 26 + exposure * 14 + resolution * 12 + colour * 4 + (nameHit ? 8 : 0));
  const problems = [];
  const blank = stats.stdLuma < 8;
  if (blank) { problems.push('the image looks blank or one flat colour'); score = Math.min(score, 15); }
  else {
    if (stats.edgeDensity < 0.01) problems.push('it is too blurry or featureless to read');
    if (exposure < 0.4) problems.push(stats.meanLuma < 128 ? 'it is too dark' : 'it is too bright');
  }
  if (Math.min(width, height) < 240) problems.push('the resolution is very low');
  score = clamp(score, 0, 100);

  if (score >= AI_THRESHOLDS.approve && !problems.length) {
    return { decision: 'approve', score, reason: `Clear, well-exposed photo (quality score ${score}/100)${nameHit ? ' and the file name matches the task' : ''}.` };
  }
  if (score < AI_THRESHOLDS.reject) {
    return { decision: 'reject', score, reason: `Proof could not be verified: ${problems.join(', ') || 'the photo has too little detail'}. Upload a clearer photo.` };
  }
  return { decision: 'needs_human', score, reason: `Quality score ${score}/100${problems.length ? ` - ${problems.join(', ')}` : ''}. Sent to an admin for a human decision.` };
}

/** Browser only: resize the proof for storage and analyse it. */
export async function prepareProofImage(file, { maxSide = 960, quality = 0.72 } = {}) {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); context.drawImage(bitmap, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);

  const sample = 96, small = document.createElement('canvas'); small.width = sample; small.height = sample;
  const smallContext = small.getContext('2d', { willReadFrequently: true });
  smallContext.drawImage(canvas, 0, 0, sample, sample);
  const stats = statsFromPixels(smallContext.getImageData(0, 0, sample, sample).data, sample, sample);
  const original = { width: bitmap.width, height: bitmap.height };
  if (bitmap.close) bitmap.close();
  return { dataUrl, width: original.width, height: original.height, stats };
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* fall through to <img> decoding */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('That file could not be read as an image.')); image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}
