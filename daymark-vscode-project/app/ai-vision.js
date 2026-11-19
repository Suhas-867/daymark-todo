// On-device vision check: does the photo actually show what the task says?
//
// A small image-text model (MobileCLIP, see vision-runtime.js) embeds the photo and a set of written
// descriptions. The descriptions are built from the task text:
//   - what a finished task should look like (positive)
//   - what an unfinished one looks like, for cleaning-style tasks (negative)
//   - a pool of unrelated scenes (other)
// Several phrasings per description are averaged ("prompt ensembling") and the photo is looked at from
// a few crops, which makes the result steadier. If the photo matches an unrelated scene or the
// "unfinished" description, it is not approved. Everything here is pure and unit-tested; the model
// itself lives in vision-runtime.js.

/* ---------- understanding the task text ---------- */

const LEAD = /^(?:(?:i|we)\s*(?:will|'ll|am going to|'m going to|want to|need to|have to|must|should|shall|can|am|'m)|let me|let's|going to|to|please|today)\s+/;
const CLEAN_VERBS = ['clean', 'tidy', 'organize', 'organise', 'declutter', 'arrange', 'sort', 'wipe', 'dust', 'mop', 'sweep', 'vacuum', 'wash', 'scrub', 'straighten', 'clear'];
const FILLER = new Set(['a', 'an', 'the', 'my', 'our', 'your', 'this', 'that', 'these', 'those', 'up', 'out', 'all', 'some', 'whole', 'entire', 'of', 'in', 'on']);

/** "i will clean a table" -> { cleaning: true, subject: "table", phrase: "clean a table" } */
export function parseTask(title) {
  let text = String(title || '').toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  text = text.replace(LEAD, '').replace(LEAD, '');
  const words = text.split(' ').filter(Boolean);
  const cleaning = CLEAN_VERBS.includes(words[0]);
  const body = (cleaning ? words.slice(1) : words).filter(word => !FILLER.has(word));
  const subject = (body.join(' ') || text || 'the task').slice(0, 60);
  return { cleaning, subject, phrase: text || subject };
}

/** Everyday tasks the parser knows how to picture. First match wins; other cleaning tasks fall through to the subject rule. */
const KNOWLEDGE = [
  { name: 'a made bed', re: /\bbed(room)?\b|\bsheets\b/, positives: ['a neatly made bed with smooth sheets and pillows', 'a bed with a neat bedspread and tidy pillows'], negatives: ['an unmade messy bed with rumpled sheets and blankets'] },
  { name: 'clean dishes', re: /\bdish(es)?\b|\bplates?\b|\butensils\b|\bpots?\b|\bpans?\b/, positives: ['clean dishes drying on a rack', 'neatly stacked clean plates'], negatives: ['a sink full of dirty dishes', 'dirty plates and pans piled up', 'a messy kitchen counter with dirty dishes'] },
  { name: 'folded laundry', re: /\blaundry\b|\bclothes\b|\bfold(ing)?\b|\biron(ing)?\b/, positives: ['neatly folded clothes in a stack', 'clean laundry folded and put away'], negatives: ['a messy pile of clothes', 'clothes scattered on the floor'] },
  { name: 'reading', re: /\bread(ing)?\b|\bchapters?\b|\bnovel\b|\bbook\b/, positives: ['a person reading a book', 'an open book on a table', 'a hand holding an open book'] },
  { name: 'studying', re: /\b(write|writing|essay|homework|assignment|notes?|study|studying|revise|revision|practice|exam|maths?|science)\b/, positives: ['a notebook with handwritten notes', 'a student studying at a desk with books', 'a person writing in a notebook', 'a textbook and notes on a desk'] },
  { name: 'exercise', re: /\b(exercise|workout|gym|run|running|jog|jogging|yoga|pushups?|push-ups?|stretch(ing)?|walk(ing)?|cycl(e|ing)|swim(ming)?|sports?|football|cricket|badminton)\b/, positives: ['a person exercising', 'a person running or jogging outdoors', 'a gym with workout equipment', 'a person doing yoga or stretching', 'a sports field or court'] },
  { name: 'cooking', re: /\b(cook(ing)?|dinner|lunch|breakfast|bak(e|ing)|meal|recipe|food)\b/, positives: ['a plate of freshly cooked food', 'food cooking in a pan on a stove', 'a home cooked meal on a table'] },
  { name: 'plants', re: /\b(plants?|gardens?|gardening|water(ing)?)\b/, positives: ['a person watering plants', 'a green potted plant', 'a garden with plants'] },
  { name: 'computer work', re: /\b(code|coding|program(ming)?|laptop|computer|software|website|project)\b/, positives: ['a laptop screen showing code', 'a person working on a laptop at a desk', 'a computer screen with a program open'] }
];

const SCENE_POOL = ['a ceiling', 'a floor', 'a wall', 'a window', 'a bed', 'a kitchen', 'a bathroom', 'a desk with a laptop', 'a table', 'a sofa', 'a book', 'handwritten notes on paper', 'a person', 'food on a plate', 'a car', 'a street outside', 'trees and plants', 'a phone screen', 'a computer screen', 'clothes', 'dishes in a sink', 'a bag', 'a pet', 'a gym', 'a shelf', 'a blank wall', 'a crowd of people', 'a landscape', 'a toy', 'a poster or printed paper'];
const TEMPLATES = ['a photo of {}', 'a photograph of {}', 'a close-up picture of {}'];

const withTemplates = text => TEMPLATES.map(template => template.replace('{}', text));
const article = noun => (/^[aeiou]/.test(noun) ? 'an' : 'a');

/**
 * The competing descriptions ("concepts") the photo is scored against. Each concept has several phrasings
 * that are averaged into one embedding.
 */
export function buildConcepts(title) {
  const task = parseTask(title), concepts = [];
  const add = (kind, text) => concepts.push({ id: `${kind}:${text}`, kind, text, prompts: withTemplates(text) });
  const knowledge = KNOWLEDGE.find(rule => rule.re.test(task.phrase));
  let name = task.subject;

  if (knowledge) {
    name = knowledge.name;
    knowledge.positives.forEach(text => add('positive', text));
    (knowledge.negatives || []).forEach(text => add('negative', text));
  } else if (task.cleaning) {
    for (const text of [`a clean tidy ${task.subject}`, `a neat organized ${task.subject}`, `a clear empty ${task.subject} with nothing on it`]) add('positive', text);
    for (const text of [`a messy cluttered ${task.subject}`, `a ${task.subject} covered with bags and clutter`, `a dirty ${task.subject}`]) add('negative', text);
  } else {
    add('positive', `${article(task.subject)} ${task.subject}`.trim());
    if (task.phrase !== task.subject) add('positive', task.phrase);
  }
  const subjectWords = `${task.subject} ${knowledge ? knowledge.positives.join(' ') : ''}`.split(' ').filter(word => word.length > 3);
  for (const scene of SCENE_POOL) {
    const overlaps = subjectWords.some(word => scene.includes(word)) || (task.subject.includes('table') && scene === 'a table');
    if (!overlaps) add('other', scene);
  }
  return { task, concepts, name, hasNegatives: concepts.some(concept => concept.kind === 'negative') };
}

/* ---------- decision rules ---------- */

/** probabilities: number[] aligned with `concepts`, summing to ~1. */
export function judgeContent(title, concepts, probabilities, name = parseTask(title).subject) {
  let positive = 0, negative = 0, top = 0;
  concepts.forEach((concept, index) => { if (concept.kind === 'positive') positive += probabilities[index]; else if (concept.kind === 'negative') negative += probabilities[index]; if (probabilities[index] > probabilities[top]) top = index; });
  const topConcept = concepts[top], pct = value => Math.round(value * 100), seen = topConcept.text.replace(/^an? /, '');
  const result = { positive, negative, topLabel: seen };
  const hasNegatives = concepts.some(concept => concept.kind === 'negative');

  if (hasNegatives) {
    if (positive >= 0.5 && negative < 0.3) return { ...result, decision: 'approve', reason: `The photo looks like ${name} (${pct(positive)}% match).` };
    if (negative >= 0.45 && negative >= positive * 1.8) return { ...result, decision: 'reject', reason: `${name[0].toUpperCase()}${name.slice(1)} does not look finished: it looks like "${seen}" (${pct(negative)}% unfinished, ${pct(positive)}% finished).` };
    if (positive + negative < 0.2 && topConcept.kind === 'other') return { ...result, decision: 'reject', reason: `This does not look like ${name}. It looks more like ${seen}.` };
    return { ...result, decision: 'needs_human', reason: `Not sure the task is done (${pct(positive)}% finished, ${pct(negative)}% unfinished).` };
  }
  if (positive >= 0.5) return { ...result, decision: 'approve', reason: `The photo matches "${name}" (${pct(positive)}% match).` };
  if (positive < 0.1 && topConcept.kind === 'other') return { ...result, decision: 'reject', reason: `This does not look like "${name}". It looks more like ${seen}.` };
  return { ...result, decision: 'needs_human', reason: `Only a ${pct(positive)}% match with "${name}"; it looks most like ${seen}.` };
}

/** Merge the photo-quality check with the content check. Quality alone can never approve. */
export function combineVerdicts(quality, content) {
  if (quality.decision === 'reject') return { decision: 'reject', score: quality.score, reason: quality.reason };
  if (!content) return { decision: 'needs_human', score: quality.score, reason: 'The AI model could not be loaded, so an admin needs to check what the photo shows.' };
  const score = Math.round(100 * Math.max(content.positive, 0));
  if (content.decision === 'approve') return { decision: 'approve', score, reason: `${content.reason} Photo quality ${quality.score}/100.` };
  return { decision: content.decision, score, reason: content.reason };
}

/* ---------- scoring with an embedding runtime ---------- */

export const LOGIT_SCALE = 100;
export const normalize = vector => { const length = Math.hypot(...vector) || 1; return vector.map(value => value / length); };
export const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
export function softmax(values) { const max = Math.max(...values), exps = values.map(value => Math.exp(value - max)), total = exps.reduce((a, b) => a + b, 0); return exps.map(value => value / total); }
export const meanVector = vectors => normalize(vectors[0].map((_, index) => vectors.reduce((sum, vector) => sum + vector[index], 0) / vectors.length));

/**
 * runtime = { embedTexts(prompts) -> number[][] (normalised), embedImage(imageUrl) -> number[] (normalised, already averaged over crops) }
 */
export async function scoreWithRuntime(runtime, imageUrl, title) {
  const { concepts, name } = buildConcepts(title);
  const allPrompts = concepts.flatMap(concept => concept.prompts), embedded = await runtime.embedTexts(allPrompts);
  let cursor = 0;
  const conceptVectors = concepts.map(concept => { const slice = embedded.slice(cursor, cursor + concept.prompts.length); cursor += concept.prompts.length; return meanVector(slice); });
  const image = await runtime.embedImage(imageUrl);
  const probabilities = softmax(conceptVectors.map(vector => LOGIT_SCALE * dot(image, vector)));
  return { ...judgeContent(title, concepts, probabilities, name), probabilities, concepts: concepts.map(({ kind, text }) => ({ kind, text })) };
}

/** Browser entry point used by the app. */
export async function reviewContent(imageUrl, title, onProgress) {
  const { loadRuntime } = await import('./vision-runtime.js');
  return scoreWithRuntime(await loadRuntime(onProgress), imageUrl, title);
}

/** Start downloading the model in the background (safe to call repeatedly). */
export async function warmUp(onProgress) {
  const { loadRuntime } = await import('./vision-runtime.js');
  return loadRuntime(onProgress);
}
