import test from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, warnWindowMs } from '../user-app.js';

test('formats countdowns as mm:ss and h:mm:ss for long timers', () => {
  assert.equal(formatClock(61_000), '01:01');
  assert.equal(formatClock(59_001), '01:00');
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(-5_000), '00:00');
  assert.equal(formatClock(24 * 3600_000), '24:00:00');
  assert.equal(formatClock(3723_000), '1:02:03');
});

test('warns before the end: 5 minutes at most, a quarter of short timers, never under 10 seconds', () => {
  assert.equal(warnWindowMs(1), 15_000);
  assert.equal(warnWindowMs(5), 75_000);
  assert.equal(warnWindowMs(30), 300_000);
  assert.equal(warnWindowMs(1440), 300_000);
  assert.equal(warnWindowMs(0.1), 10_000);
});
