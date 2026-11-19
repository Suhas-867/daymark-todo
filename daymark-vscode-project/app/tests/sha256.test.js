import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex } from '../sha256.js';
import { adminEmailHashes } from '../access-config.js';
import { isAdminEmail } from '../local-db.js';

test('sha256 matches the reference implementation, including long and non-ASCII input', () => {
  for (const text of ['', 'abc', 'suhasm867@gmail.com', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000), 'héllo wörld ✓']) {
    assert.equal(sha256Hex(text), createHash('sha256').update(text).digest('hex'), JSON.stringify(text.slice(0, 20)));
  }
});

test('the administrator list stores only hashes and matches case-insensitively', () => {
  assert.ok(adminEmailHashes.every(hash => /^[0-9a-f]{64}$/.test(hash)));
  assert.equal(isAdminEmail('suhasm867@gmail.com'), true);
  assert.equal(isAdminEmail('  SuhasM867@Gmail.com '), true);
  assert.equal(isAdminEmail('someone@else.com'), false);
  assert.equal(isAdminEmail(''), false);
});
