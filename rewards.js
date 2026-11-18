export const REWARDS_KEY = 'daymark.demo-rewards.v1';
export const FREE_TASK_LIMIT = 10;

const MEMBERSHIP_DAYS = 30;
const POINTS_PER_MILESTONE = 1000;
const DEMO_REWARD_RUPEES = 30;

export function emptyRewards() {
  return { membershipStartedAt: null, membershipExpiresAt: null, trialTasksUsed: 0, points: 0, milestonesReached: 0, demoRupeesEarned: 0 };
}

export function loadRewards(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(REWARDS_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyRewards();
    return {
      membershipStartedAt: typeof parsed.membershipStartedAt === 'string' ? parsed.membershipStartedAt : null,
      membershipExpiresAt: typeof parsed.membershipExpiresAt === 'string' ? parsed.membershipExpiresAt : null,
      trialTasksUsed: Number.isFinite(parsed.trialTasksUsed) ? Math.max(0, Math.trunc(parsed.trialTasksUsed)) : 0,
      points: 0,
      milestonesReached: 0,
      demoRupeesEarned: Number.isFinite(parsed.demoRupeesEarned) ? Math.max(0, Math.trunc(parsed.demoRupeesEarned)) : 0
    };
  } catch {
    return emptyRewards();
  }
}

export function hasActiveMembership(rewards, now = new Date()) {
  const expiry = Date.parse(rewards.membershipExpiresAt || '');
  return Number.isFinite(expiry) && expiry > now.getTime();
}

export function extendDemoMembership(rewards, now = new Date()) {
  const currentExpiry = Date.parse(rewards.membershipExpiresAt || '');
  const base = Number.isFinite(currentExpiry) ? Math.max(currentExpiry, now.getTime()) : now.getTime();
  return {
    ...rewards,
    membershipStartedAt: rewards.membershipStartedAt || now.toISOString(),
    membershipExpiresAt: new Date(base + MEMBERSHIP_DAYS * 24 * 60 * 60_000).toISOString()
  };
}

export function applyPointDelta(rewards, delta) {
  const next = { ...rewards, points: rewards.points + Math.trunc(delta) };
  let newMilestones = 0;
  while (next.points >= (next.milestonesReached + 1) * POINTS_PER_MILESTONE) {
    next.milestonesReached += 1;
    next.demoRupeesEarned += DEMO_REWARD_RUPEES;
    newMilestones += 1;
  }
  return { rewards: next, newMilestones };
}

export function milestoneProgress(rewards) {
  const target = (rewards.milestonesReached + 1) * POINTS_PER_MILESTONE;
  const inCurrentMilestone = Math.max(0, Math.min(POINTS_PER_MILESTONE, rewards.points - rewards.milestonesReached * POINTS_PER_MILESTONE));
  return { target, points: inCurrentMilestone, percent: Math.round(inCurrentMilestone / POINTS_PER_MILESTONE * 100) };
}
