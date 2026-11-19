// Shared review logic for the Firestore backend: used by the member's device (instant AI decisions)
// and by the admin console (manual decisions). Everything happens inside one Firestore transaction so a
// proof can only be settled once and the points land on the member's newest session.
//
// `sdk` is the small subset of the Firebase JS SDK the app uses (doc, runTransaction, updateDoc, ...), so
// the same code runs in the browser (CDN build) and in tests (a fake).
import { applyPointDelta, emptyRewards } from './rewards.js';
import { POINTS_ON_TIME, POINTS_PENALTY } from './local-db.js';

export const sessionToRewards = session => ({
  ...emptyRewards(), membershipStartedAt: session.membershipStartedAt ?? null, membershipExpiresAt: session.membershipExpiresAt ?? null,
  points: session.points || 0, milestonesReached: session.milestonesReached || 0, demoRupeesEarned: session.demoRupeesEarned || 0
});
export const rewardsToSessionPatch = rewards => ({ points: rewards.points, milestonesReached: rewards.milestonesReached, demoRupeesEarned: rewards.demoRupeesEarned });

/**
 * Settle a pending proof. outcome: 'approve' | 'reject' (back on the clock if time is left) | 'fail' (the admin rejects the
 * proof outright: the task ends and 500 points are deducted); reviewer: 'ai' | 'admin'.
 */
export async function settleProof(sdk, db, proofId, outcome, reason, reviewer, now = Date.now()) {
  const { doc, runTransaction } = sdk;
  return runTransaction(db, async tx => {
    const queueRef = doc(db, 'reviewQueue', proofId), queue = await tx.get(queueRef);
    if (!queue.exists() || queue.data().status !== 'pending') return { applied: false };
    const entry = queue.data(), taskRef = doc(db, 'users', entry.uid, 'tasks', entry.taskId), userRef = doc(db, 'users', entry.uid);
    const task = await tx.get(taskRef), user = await tx.get(userRef);
    const sessionId = user.data()?.activeSessionId || task.data()?.sessionId, sessionRef = sessionId ? doc(db, 'users', entry.uid, 'sessions', sessionId) : null;
    const session = sessionRef ? await tx.get(sessionRef) : null;

    tx.update(queueRef, { status: outcome === 'approve' ? 'approved' : 'rejected', reviewedAt: now, reviewReason: reason, reviewer, aiState: 'done', failedTask: outcome === 'fail' });
    if (task.exists()) {
      const patch = { reviewedAt: now, reviewReason: reason, reviewer, aiState: 'done' }; let delta = 0;
      if (outcome === 'approve') { patch.status = 'approved'; delta = POINTS_ON_TIME; }
      else if (outcome === 'fail') { patch.status = 'failed'; patch.failedAt = now; delta = -POINTS_PENALTY; }
      else if (task.data().deadlineAt > now) patch.status = 'pending'; // back on the clock
      else { patch.status = 'failed'; patch.failedAt = now; delta = -POINTS_PENALTY; }
      tx.update(taskRef, patch);
      if (delta && session?.exists()) tx.update(sessionRef, rewardsToSessionPatch(applyPointDelta(sessionToRewards(session.data()), delta).rewards));
    }
    return { applied: true, outcome };
  });
}

/** The AI could not decide: leave the proof in the admin queue with the AI's note. */
export async function markNeedsHuman(sdk, db, proofId, { reason, score }) {
  const { doc, runTransaction } = sdk;
  return runTransaction(db, async tx => {
    const queueRef = doc(db, 'reviewQueue', proofId), queue = await tx.get(queueRef);
    if (!queue.exists() || queue.data().status !== 'pending') return { applied: false };
    const entry = queue.data(), taskRef = doc(db, 'users', entry.uid, 'tasks', entry.taskId);
    tx.update(queueRef, { aiState: 'done', aiSuggestion: 'needs_human', aiReason: reason, aiScore: score ?? null });
    tx.update(taskRef, { aiState: 'done' });
    return { applied: true };
  });
}

/** If the page closed while the AI was thinking, hand those proofs to a human. */
export async function recoverInterruptedAi(sdk, db, uid, olderThanMs, now = Date.now()) {
  const { collection, getDocs, query, where } = sdk;
  const snapshot = await getDocs(query(collection(db, 'reviewQueue'), where('uid', '==', uid)));
  for (const item of snapshot.docs) {
    const entry = item.data();
    if (entry.status === 'pending' && entry.aiState === 'analyzing' && now - entry.submittedAt >= olderThanMs) {
      await markNeedsHuman(sdk, db, item.id, { reason: 'The AI check was interrupted, so an admin needs to review this proof.', score: null }).catch(() => {});
    }
  }
}
