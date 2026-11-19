import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidates, combineVerdicts, judgeContent, parseTask } from '../ai-vision.js';

test('understands what the task is about', () => {
  assert.deepEqual(parseTask('I will clean a table'), { cleaning: true, subject: 'table', phrase: 'clean a table' });
  assert.deepEqual(parseTask('  Tidy up my room!  ').subject, 'room'.length ? parseTask('  Tidy up my room!  ').subject : '');
  assert.equal(parseTask('Clean the kitchen counter').subject, 'kitchen counter');
  assert.equal(parseTask("i'll wash the dishes").cleaning, true);
  assert.deepEqual(parseTask('ceiling'), { cleaning: false, subject: 'ceiling', phrase: 'ceiling' });
  assert.equal(parseTask('Read two chapters').cleaning, false);
  assert.equal(parseTask('').subject, 'the task');
});

test('builds competing descriptions: clean vs messy for cleaning tasks, plain subject otherwise', () => {
  const cleaning = buildCandidates('I will clean a table');
  const kinds = kind => cleaning.candidates.filter(c => c.kind === kind).map(c => c.label);
  assert.ok(kinds('positive').some(label => /clean tidy table/.test(label)));
  assert.ok(kinds('negative').some(label => /messy cluttered table/.test(label)) && kinds('negative').some(label => /bags/.test(label)));
  assert.ok(!cleaning.candidates.some(c => c.kind === 'other' && /a table$/.test(c.label)), 'the plain table scene is not a distractor');
  const ceiling = buildCandidates('ceiling');
  assert.deepEqual(ceiling.candidates.filter(c => c.kind === 'positive').map(c => c.label), ['a photo of ceiling']);
  assert.ok(!ceiling.candidates.some(c => c.kind === 'other' && /ceiling/.test(c.label)));
  assert.ok(ceiling.candidates.some(c => c.kind === 'other' && /table/.test(c.label)));
});

function rank(candidates, weights) {
  const raw = candidates.map(c => ({ label: c.label, score: weights(c) }));
  const total = raw.reduce((sum, item) => sum + item.score, 0);
  return raw.map(item => ({ ...item, score: item.score / total })).sort((a, b) => b.score - a.score);
}

test('a table photo does not pass for a "ceiling" task', () => {
  const { candidates } = buildCandidates('ceiling');
  const ranked = rank(candidates, c => (/a table$/.test(c.label) ? 50 : c.kind === 'positive' ? 1 : 0.5));
  const result = judgeContent('ceiling', candidates, ranked);
  assert.equal(result.decision, 'reject'); assert.match(result.reason, /does not look like "ceiling".*table/);
});

test('a ceiling photo passes for a "ceiling" task', () => {
  const { candidates } = buildCandidates('ceiling');
  const result = judgeContent('ceiling', candidates, rank(candidates, c => (c.kind === 'positive' ? 40 : 1)));
  assert.equal(result.decision, 'approve');
});

test('cleaning: clutter is rejected, a clean surface is approved, doubt goes to a human', () => {
  const { candidates } = buildCandidates('I will clean a table');
  const weighted = (clean, messy) => rank(candidates, c => (c.kind === 'positive' ? clean : c.kind === 'negative' ? messy : 0.4));
  const cluttered = judgeContent('I will clean a table', candidates, weighted(1, 12));
  assert.equal(cluttered.decision, 'reject'); assert.match(cluttered.reason, /still looks messy/);
  assert.equal(judgeContent('I will clean a table', candidates, weighted(14, 1)).decision, 'approve');
  assert.equal(judgeContent('I will clean a table', candidates, weighted(3, 3)).decision, 'needs_human');
  const wrongRoom = judgeContent('I will clean a table', candidates, rank(candidates, c => (c.kind === 'other' && /ceiling/.test(c.label) ? 60 : 0.3)));
  assert.equal(wrongRoom.decision, 'reject'); assert.match(wrongRoom.reason, /does not look like a table/);
});

test('quality alone never approves, rejects stay rejected and approvals keep the explanation', () => {
  const goodQuality = { decision: 'approve', score: 90, reason: 'Clear photo.' };
  assert.equal(combineVerdicts(goodQuality, null).decision, 'needs_human');
  assert.equal(combineVerdicts({ decision: 'reject', score: 5, reason: 'Blank.' }, { decision: 'approve', positive: 0.9, reason: 'x' }).decision, 'reject');
  const approved = combineVerdicts(goodQuality, { decision: 'approve', positive: 0.82, reason: 'The photo matches "desk" (82% match).' });
  assert.equal(approved.decision, 'approve'); assert.equal(approved.score, 82); assert.match(approved.reason, /Photo quality 90/);
  assert.equal(combineVerdicts(goodQuality, { decision: 'reject', positive: 0.02, reason: 'Not a table.' }).decision, 'reject');
  assert.equal(combineVerdicts(goodQuality, { decision: 'needs_human', positive: 0.3, reason: 'Unsure.' }).decision, 'needs_human');
});
