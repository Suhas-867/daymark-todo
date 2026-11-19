// On-device vision check: does the photo actually show what the task says?
//
// Uses CLIP (zero-shot image classification) through transformers.js, loaded on demand from a CDN.
// The model (about 150 MB, cached by the browser after the first use) runs entirely in the page; the
// photo never leaves the device. The task text is turned into competing descriptions: what a finished
// task should look like, what an unfinished one looks like (for cleaning tasks) and a pool of unrelated
// scenes. If the photo matches an unrelated scene, or the "unfinished" description, it is not approved.

const LIBRARY = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
export const VISION_MODEL = 'Xenova/clip-vit-base-patch32';

/* ---------- understanding the task text (pure, unit-tested) ---------- */

const LEAD = /^(?:(?:i|we)\s*(?:will|'ll|am going to|'m going to|want to|need to|have to|must|should|shall|can)|let me|let's|going to|to|please)\s+/;
const CLEAN_VERBS = ['clean', 'tidy', 'organize', 'organise', 'declutter', 'arrange', 'sort', 'wipe', 'dust', 'mop', 'sweep', 'vacuum', 'wash', 'scrub', 'straighten', 'clear'];
const FILLER = new Set(['a', 'an', 'the', 'my', 'our', 'your', 'this', 'that', 'these', 'those', 'up', 'out', 'all', 'some', 'whole', 'entire', 'of', 'in', 'on', 'room']);

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

const PHOTO = 'a photo of ';
const GENERIC_SCENES = ['a ceiling', 'a floor', 'a wall', 'a window', 'a bed', 'a kitchen', 'a bathroom', 'a desk with a laptop', 'a table', 'a sofa', 'a book', 'handwritten notes on paper', 'a person', 'food on a plate', 'a car', 'a street outside', 'trees and plants', 'a phone screen', 'a computer screen', 'clothes', 'dishes in a sink', 'a bag', 'a pet', 'a gym', 'a shelf', 'a blank wall'];

/** Descriptions CLIP chooses between. `kind` tells the judge what each one means. */
export function buildCandidates(title) {
  const task = parseTask(title), subjectWords = task.subject.split(' ');
  const candidates = [];
  if (task.cleaning) {
    for (const text of [`a clean tidy ${task.subject}`, `a clear empty ${task.subject} with nothing on it`]) candidates.push({ label: PHOTO + text, kind: 'positive' });
    for (const text of [`a messy cluttered ${task.subject}`, `a ${task.subject} covered with bags and clutter`, `a dirty ${task.subject}`]) candidates.push({ label: PHOTO + text, kind: 'negative' });
  } else {
    candidates.push({ label: PHOTO + task.subject, kind: 'positive' });
    if (task.phrase !== task.subject) candidates.push({ label: PHOTO + task.phrase, kind: 'positive' });
  }
  for (const scene of GENERIC_SCENES) if (!subjectWords.some(word => word.length > 3 && scene.includes(word)) && !(scene === 'a table' && task.subject.includes('table'))) candidates.push({ label: PHOTO + scene, kind: 'other' });
  return { task, candidates };
}

const tidy = label => label.replace(PHOTO, '').replace(/^an? /, '');

/**
 * Turn CLIP's ranked results into a decision.
 * @param ranked [{label, score}] with scores summing to ~1 over the candidates
 */
export function judgeContent(title, candidates, ranked) {
  const kinds = new Map(candidates.map(candidate => [candidate.label, candidate.kind]));
  const task = parseTask(title);
  let positive = 0, negative = 0;
  for (const item of ranked) { const kind = kinds.get(item.label); if (kind === 'positive') positive += item.score; else if (kind === 'negative') negative += item.score; }
  const top = ranked[0], topKind = kinds.get(top.label), pct = value => Math.round(value * 100);
  const result = { positive, negative, topLabel: tidy(top.label) };

  if (task.cleaning) {
    if (positive >= 0.5 && negative < 0.3) return { ...result, decision: 'approve', reason: `The photo looks like a clean ${task.subject} (${pct(positive)}% match).` };
    if (negative >= 0.45 && negative >= positive * 1.8) return { ...result, decision: 'reject', reason: `The ${task.subject} still looks messy or cluttered (${pct(negative)}% cluttered, ${pct(positive)}% clean).` };
    if (positive + negative < 0.2 && topKind === 'other') return { ...result, decision: 'reject', reason: `This does not look like a ${task.subject}. It looks more like ${tidy(top.label)}.` };
    return { ...result, decision: 'needs_human', reason: `Not sure the ${task.subject} is clean (${pct(positive)}% clean, ${pct(negative)}% messy).` };
  }
  if (positive >= 0.5) return { ...result, decision: 'approve', reason: `The photo matches "${task.subject}" (${pct(positive)}% match).` };
  if (positive < 0.1 && topKind === 'other') return { ...result, decision: 'reject', reason: `This does not look like "${task.subject}". It looks more like ${tidy(top.label)}.` };
  return { ...result, decision: 'needs_human', reason: `Only a ${pct(positive)}% match with "${task.subject}"; it looks most like ${tidy(top.label)}.` };
}

/* ---------- running the model (browser only) ---------- */

let classifierPromise = null;
export const visionLoaded = () => Boolean(classifierPromise) && classifierPromise.settled === true;

/** Start loading the model. onProgress receives 0..100. Safe to call repeatedly. */
export function warmUp(onProgress = () => {}) {
  if (!classifierPromise) {
    const files = new Map();
    classifierPromise = (async () => {
      const { pipeline, env } = await import(/* webpackIgnore: true */ LIBRARY);
      env.allowLocalModels = false;
      const classifier = await pipeline('zero-shot-image-classification', VISION_MODEL, {
        progress_callback: event => {
          if (event.status === 'progress' && event.file) {
            files.set(event.file, event.progress || 0);
            const values = [...files.values()]; onProgress(Math.round(values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1)));
          }
        }
      });
      classifierPromise.settled = true; onProgress(100);
      return classifier;
    })();
    classifierPromise.catch(() => { classifierPromise = null; }); // allow a retry after a network failure
  }
  return classifierPromise;
}

/** Returns the judged content result for a photo (data URL) and the task text. Throws if the model cannot load. */
export async function reviewContent(imageUrl, title, onProgress) {
  const classifier = await warmUp(onProgress), { candidates } = buildCandidates(title);
  const ranked = await classifier(imageUrl, candidates.map(candidate => candidate.label), { hypothesis_template: '{}', topk: candidates.length });
  return judgeContent(title, candidates, ranked);
}

/**
 * Merge the photo-quality check with the content check into the final AI verdict.
 * Quality alone can never approve: without a content match the proof goes to a human.
 * @param quality {decision, score, reason} from scoreProof; content from judgeContent or null when the model was unavailable
 */
export function combineVerdicts(quality, content) {
  if (quality.decision === 'reject') return { decision: 'reject', score: quality.score, reason: quality.reason };
  if (!content) return { decision: 'needs_human', score: quality.score, reason: 'The AI model could not be loaded, so an admin needs to check what the photo shows.' };
  const score = Math.round(100 * Math.max(content.positive, 0));
  if (content.decision === 'approve') return { decision: 'approve', score, reason: `${content.reason} Photo quality ${quality.score}/100.` };
  return { decision: content.decision, score, reason: content.reason };
}
