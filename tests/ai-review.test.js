import test from 'node:test';
import assert from 'node:assert/strict';
import { hashDistance, scoreProof, statsFromPixels } from '../ai-review.js';

const SIZE = 96;
function image(pixel) {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) { const [r, g, b] = pixel(x, y); const i = (y * SIZE + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; }
  return data;
}
// Deterministic pseudo-random "busy photo".
const noise = (x, y) => { const v = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1; return [v * 255, ((v * 7) % 1) * 255, ((v * 13) % 1) * 255]; };
const checks = (x, y) => (((x >> 2) + (y >> 2)) % 2 ? [230, 210, 180] : [40, 60, 90]);
const analyse = pixel => statsFromPixels(image(pixel), SIZE, SIZE);

test('blank images are rejected', () => {
  const result = scoreProof({ stats: analyse(() => [255, 255, 255]), width: 1200, height: 900, taskTitle: 'Clean desk' });
  assert.equal(result.decision, 'reject'); assert.match(result.reason, /blank/);
});

test('detailed, high-resolution images are approved', () => {
  const result = scoreProof({ stats: analyse(checks), width: 1600, height: 1200, taskTitle: 'Clean desk', fileName: 'desk.jpg' });
  assert.equal(result.decision, 'approve'); assert.ok(result.score >= 62);
});

test('dark or tiny images are not approved automatically', () => {
  const dark = scoreProof({ stats: analyse((x, y) => noise(x, y).map(v => v * 0.1)), width: 1600, height: 1200, taskTitle: 'Read' });
  assert.notEqual(dark.decision, 'approve'); assert.match(dark.reason, /dark|blank|detail|Quality/);
  const tiny = scoreProof({ stats: analyse(checks), width: 120, height: 90, taskTitle: 'Read' });
  assert.notEqual(tiny.decision, 'approve');
});

test('matching file names help and duplicates are rejected', () => {
  const stats = analyse((x, y) => (((x >> 4) + (y >> 4)) % 2 ? [150, 150, 150] : [100, 100, 100]));
  const plain = scoreProof({ stats, width: 640, height: 640, taskTitle: 'Water the plants', fileName: 'IMG_1.jpg' });
  const named = scoreProof({ stats, width: 640, height: 640, taskTitle: 'Water the plants', fileName: 'plants.jpg' });
  assert.ok(named.score > plain.score);
  assert.equal(scoreProof({ stats, width: 640, height: 640, duplicateOf: 'abc' }).decision, 'reject');
});

test('fingerprints match for the same picture and differ for different ones', () => {
  const a = analyse(checks).fingerprint, b = analyse(checks).fingerprint, c = analyse((x, y) => (x < 48 ? [255, 255, 255] : [0, 0, 0])).fingerprint;
  assert.equal(hashDistance(a, b), 0);
  assert.ok(hashDistance(a, c) > 3);
  assert.equal(a.length, 16);
});
