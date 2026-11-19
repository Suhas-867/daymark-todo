import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConcepts, combineVerdicts, dot, judgeContent, meanVector, normalize, parseTask, scoreWithRuntime, softmax } from '../ai-vision.js';

test('understands what the task is about', () => {
  assert.deepEqual(parseTask('I will clean a table'), { cleaning: true, subject: 'table', phrase: 'clean a table' });
  assert.equal(parseTask('Tidy up my room!').subject, 'room');
  assert.equal(parseTask('Clean the kitchen counter').subject, 'kitchen counter');
  assert.equal(parseTask("i'll wash the dishes").cleaning, true);
  assert.deepEqual(parseTask('ceiling'), { cleaning: false, subject: 'ceiling', phrase: 'ceiling' });
  assert.equal(parseTask('Read two chapters').cleaning, false);
  assert.equal(parseTask('').subject, 'the task');
});

test('knows everyday tasks and what finished / unfinished looks like', () => {
  const texts = (title, kind) => buildConcepts(title).concepts.filter(c => c.kind === kind).map(c => c.text).join(' | ');
  assert.match(texts('make my bed', 'positive'), /neatly made bed/); assert.match(texts('make my bed', 'negative'), /unmade/);
  assert.match(texts('wash the dishes', 'positive'), /clean dishes/); assert.match(texts('wash the dishes', 'negative'), /dirty/);
  assert.match(texts('fold the laundry', 'positive'), /folded/);
  assert.match(texts('read two chapters', 'positive'), /reading a book/);
  assert.match(texts('go for a run', 'positive'), /running|exercising/);
  assert.match(texts('cook dinner', 'positive'), /cooked food/);
  assert.match(texts('Do homework', 'positive'), /notes|studying/);
});

test('cleaning tasks get clean-vs-messy descriptions, other tasks the plain subject, and every concept has several phrasings', () => {
  const cleaning = buildConcepts('I will clean a table');
  const kind = k => cleaning.concepts.filter(c => c.kind === k).map(c => c.text);
  assert.ok(kind('positive').some(t => /clean tidy table/.test(t)));
  assert.ok(kind('negative').some(t => /messy cluttered table/.test(t)) && kind('negative').some(t => /bags/.test(t)));
  assert.ok(!kind('other').includes('a table'), 'the plain table scene is not a distractor');
  assert.ok(cleaning.concepts.every(c => c.prompts.length === 3 && c.prompts.every(p => p.includes(c.text))));
  const ceiling = buildConcepts('ceiling');
  assert.deepEqual(ceiling.concepts.filter(c => c.kind === 'positive').map(c => c.text), ['a ceiling']);
  assert.ok(!ceiling.concepts.some(c => c.kind === 'other' && c.text === 'a ceiling'));
  assert.ok(ceiling.concepts.some(c => c.kind === 'other' && c.text === 'a table'));
  assert.equal(ceiling.hasNegatives, false);
});

test('vector helpers', () => {
  assert.deepEqual(normalize([3, 4]), [0.6, 0.8]);
  assert.equal(dot([1, 2], [3, 4]), 11);
  const p = softmax([0, 0, Math.log(2)]); assert.ok(Math.abs(p.reduce((a, b) => a + b) - 1) < 1e-9 && p[2] > p[0]);
  assert.ok(Math.abs(Math.hypot(...meanVector([[1, 0], [0, 1]])) - 1) < 1e-9);
});

const probsFor = (concepts, weight) => softmax(concepts.map(weight));

test('a table photo does not pass for a "ceiling" task, a ceiling photo does', () => {
  const { concepts } = buildConcepts('ceiling');
  const mismatch = judgeContent('ceiling', concepts, probsFor(concepts, c => (c.text === 'a table' ? 8 : c.kind === 'positive' ? 0 : 1)));
  assert.equal(mismatch.decision, 'reject'); assert.match(mismatch.reason, /does not look like "ceiling".*table/);
  assert.equal(judgeContent('ceiling', concepts, probsFor(concepts, c => (c.kind === 'positive' ? 8 : 0))).decision, 'approve');
  assert.equal(judgeContent('ceiling', concepts, probsFor(concepts, c => (c.kind === 'positive' ? 2 : c.text === 'a wall' ? 2 : 0))).decision, 'needs_human');
});

test('cleaning: clutter is rejected, a clean surface is approved, doubt goes to a human', () => {
  const { concepts } = buildConcepts('I will clean a table'), title = 'I will clean a table';
  const weighted = (clean, messy) => probsFor(concepts, c => (c.kind === 'positive' ? clean : c.kind === 'negative' ? messy : 0));
  const cluttered = judgeContent(title, concepts, weighted(0, 5));
  assert.equal(cluttered.decision, 'reject'); assert.match(cluttered.reason, /does not look finished/);
  assert.equal(judgeContent(title, concepts, weighted(5, 0)).decision, 'approve');
  assert.equal(judgeContent(title, concepts, weighted(1.5, 1.5)).decision, 'needs_human');
  const wrongRoom = judgeContent(title, concepts, probsFor(concepts, c => (c.text === 'a ceiling' ? 12 : 0)));
  assert.equal(wrongRoom.decision, 'reject'); assert.match(wrongRoom.reason, /does not look like table/);
});

test('scores a photo end to end with an embedding runtime and averages phrasings per concept', async () => {
  // Fake 3-d embedding space: ceiling-ish prompts point at axis 0, table-ish at axis 1, everything else at axis 2.
  const axis = prompt => (/ceiling/.test(prompt) ? [1, 0, 0] : /table/.test(prompt) ? [0, 1, 0] : [0, 0, 1]);
  const runtime = { embedTexts: async prompts => prompts.map(axis), embedImage: async url => axis(url) };
  assert.equal((await scoreWithRuntime(runtime, 'ceiling.jpg', 'ceiling')).decision, 'approve');
  const tableForCeiling = await scoreWithRuntime(runtime, 'table.jpg', 'ceiling');
  assert.equal(tableForCeiling.decision, 'reject'); assert.match(tableForCeiling.reason, /table/);
  assert.equal((await scoreWithRuntime(runtime, 'ceiling.jpg', 'make my bed')).decision, 'reject');
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
