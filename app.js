import { STORAGE_KEY, addTask, clearCompleted, completeTimedTask, deleteTask, failExpiredTasks, filterTasks, loadTasks, progress, toggleTask } from './tasks.js';
import { FREE_TASK_LIMIT, REWARDS_KEY, applyPointDelta, extendDemoMembership, hasActiveMembership, loadRewards, milestoneProgress } from './rewards.js?v=party-3';

const $ = selector => document.querySelector(selector);
const list = $('#task-list');
const form = $('#task-form');
const input = $('#task-input');
const trialLockMessage = $('#trial-lock-message');
const durationInput = $('#task-duration');
const customDurationInput = $('#custom-duration');
const emptyState = $('#empty-state');
const notice = $('#reward-notice');
const outcomeOverlay = $('#outcome-overlay');
const outcomeMessage = $('#outcome-message');
let outcomeTimeout;
let tasks = loadTasks(window.localStorage);
let rewards = loadRewards(window.localStorage);
let currentFilter = 'all';

$('#today-label').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());

function saveTasks() {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); } catch { /* Keep the current session usable if storage is unavailable. */ }
}

function saveRewards() {
  try { window.localStorage.setItem(REWARDS_KEY, JSON.stringify(rewards)); } catch { /* This project is a local demonstration. */ }
}

function showNotice(message, kind = 'info') {
  notice.textContent = message;
  notice.className = `reward-notice notice-${kind}`;
  notice.hidden = false;
}

function showOutcomeMessage(message, kind) {
  window.clearTimeout(outcomeTimeout);
  outcomeMessage.textContent = message;
  outcomeOverlay.className = `outcome-overlay outcome-${kind}`;
  outcomeOverlay.hidden = false;
  outcomeTimeout = window.setTimeout(() => { outcomeOverlay.hidden = true; }, 4200);
}

function changePoints(delta) {
  if (!delta) return 0;
  const result = applyPointDelta(rewards, delta);
  rewards = result.rewards;
  saveRewards();
  return result.newMilestones;
}

function settleExpiredTasks() {
  const result = failExpiredTasks(tasks);
  if (!result.failedIds.length) return false;
  tasks = result.tasks;
  const milestoneCount = changePoints(result.pointsDelta);
  saveTasks();
  showOutcomeMessage('OOPS! THE TIMER HAS RUN OUT...BETTER LUCK NEXT TIME!', 'failure');
  showNotice(`${Math.abs(result.pointsDelta)} points deducted after the timer ended.`, 'failure');
  if (milestoneCount) showNotice(`You also reached a ${milestoneCount > 1 ? `${milestoneCount} × ` : ''}1,000-point milestone. Demo rewards earned: ₹${milestoneCount * 30}.`, 'success');
  return true;
}

function remainingTime(task) {
  return Math.max(0, Date.parse(task.deadlineAt) - Date.now());
}

function formatTimer(milliseconds) {
  const seconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function render() {
  const visibleTasks = filterTasks(tasks, currentFilter);
  const counts = progress(tasks);
    const open = tasks.filter(task => !task.completed).length;
  const activeMember = hasActiveMembership(rewards);
  const trialTasksRemaining = Math.max(0, FREE_TASK_LIMIT - rewards.trialTasksUsed);
  const canCreateTask = activeMember || trialTasksRemaining > 0;
  const milestone = milestoneProgress(rewards);

  $('#all-count').textContent = counts.total;
  $('#active-count').textContent = open;
  $('#completed-count').textContent = counts.completed;
  $('#list-summary').innerHTML = `YOUR TASKS <span class="toolbar-dot">·</span> ${visibleTasks.length} ${visibleTasks.length === 1 ? 'ITEM' : 'ITEMS'}`;
  $('#progress-percent').textContent = `${counts.percent}%`;
  $('#progress-fraction').textContent = `${counts.completed} of ${counts.total} done`;
  $('#progress-bar').style.width = `${counts.percent}%`;
  $('#progress-bar').parentElement.setAttribute('aria-label', `${counts.percent}% complete`);
  $('#progress-message').textContent = counts.total && counts.completed === counts.total ? 'Everything is wrapped up. Lovely.' : counts.completed ? 'Look at you, making progress.' : 'Every journey starts somewhere.';
  $('#clear-completed').hidden = counts.completed === 0;
  $('#list-heading').innerHTML = `${currentFilter === 'active' ? 'In progress' : currentFilter === 'completed' ? 'Completed' : 'All tasks'} <span>${visibleTasks.length}</span>`;

  $('#membership-status').textContent = activeMember ? 'Demo membership active' : trialTasksRemaining ? `Free trial · ${trialTasksRemaining} tasks left` : rewards.membershipExpiresAt ? 'Membership expired' : 'Free trial complete';
  $('#membership-expiry').textContent = activeMember ? `Active until ${formatDate(rewards.membershipExpiresAt)}` : trialTasksRemaining ? 'Create your first 10 timed tasks free.' : 'Activate the ₹99 demo membership to add more tasks.';
  $('#membership-button').textContent = activeMember ? 'Extend demo month · ₹99' : 'Activate demo plan · ₹99';
  $('#task-input').disabled = !canCreateTask;
  $('#task-duration').disabled = !canCreateTask;
  customDurationInput.disabled = !canCreateTask;
  $('#task-form').querySelector('.add-button').disabled = !canCreateTask;
  $('#task-form').classList.toggle('membership-locked', !canCreateTask);
  trialLockMessage.hidden = canCreateTask;
  input.placeholder = canCreateTask ? 'What needs to get done?' : 'Membership required to add tasks';

  $('#points-total').textContent = rewards.points;
  $('#milestone-copy').textContent = `${milestone.points.toLocaleString()} / ${milestone.target.toLocaleString()} points`;
  $('#milestone-bar').style.width = `${milestone.percent}%`;
  $('#milestone-bar').parentElement.setAttribute('aria-valuenow', String(milestone.points));
  $('#reward-total').textContent = `₹${rewards.demoRupeesEarned}`;

  list.replaceChildren(...visibleTasks.map(task => {
    const row = document.createElement('li');
    row.className = `task-row${task.completed ? ' is-complete' : ''}${task.outcome === 'pending' ? ' is-running' : ''}${task.outcome === 'failed' || task.outcome === 'late' ? ' is-missed' : ''}`;
    const check = document.createElement('input');
    check.className = 'check-button'; check.type = 'checkbox'; check.checked = task.completed;
    check.disabled = ['success', 'failed', 'late'].includes(task.outcome);
    check.setAttribute('aria-label', `${task.completed ? 'Mark as in progress' : 'Mark as complete'}: ${task.title}`);
    check.addEventListener('change', () => {
      if (task.outcome === 'pending') {
        const result = completeTimedTask(tasks, task.id);
        tasks = result.tasks;
        const milestoneCount = changePoints(result.pointsDelta);
        saveTasks();
        if (result.pointsDelta > 0) showOutcomeMessage('CONGRATULATIONS!! YOU HAVE COMPLETED THE TASK!! +100 POINTS 🎉', 'success');
        else if (result.pointsDelta < 0) showOutcomeMessage('OOPS! THE TIMER HAS RUN OUT...BETTER LUCK NEXT TIME!', 'failure');
        if (result.pointsDelta < 0) showNotice('500 points deducted after the timer ended.', 'failure');
        if (milestoneCount) showNotice(`Milestone reached: ${milestoneCount * 30} demo rupees earned.`, 'success');
      } else {
        tasks = toggleTask(tasks, task.id);
        saveTasks();
      }
      render();
    });

    const title = document.createElement('span'); title.className = 'task-title'; title.textContent = task.title;
    const timer = document.createElement('span'); timer.dataset.taskTimer = task.id; timer.className = `task-timer${task.outcome === 'pending' && remainingTime(task) < 60_000 ? ' timer-urgent' : ''}`;
    if (task.outcome === 'pending') timer.textContent = `◷ ${formatTimer(remainingTime(task))}`;
    else if (task.outcome === 'success') timer.textContent = 'On time · +100 pts';
    else if (task.outcome === 'failed') timer.textContent = 'Time expired · −500 pts';
    else if (task.outcome === 'late') timer.textContent = 'Finished late · −500 pts';
    else timer.textContent = 'Existing task · no points';

    const date = document.createElement('span'); date.className = `task-date${isToday(task.createdAt) ? ' today' : ''}`; date.textContent = isToday(task.createdAt) ? 'Today' : formatDate(task.createdAt);
    const remove = document.createElement('button'); remove.className = 'delete-button'; remove.type = 'button'; remove.textContent = '×'; remove.title = 'Delete task'; remove.setAttribute('aria-label', `Delete: ${task.title}`);
    remove.addEventListener('click', () => { tasks = deleteTask(tasks, task.id); saveTasks(); render(); });
    row.append(check, title, timer, date, remove);
    return row;
  }));

  emptyState.hidden = visibleTasks.length > 0;
  if (!tasks.length) { $('#empty-title').textContent = 'A fresh start.'; $('#empty-copy').textContent = 'Add your first timed task and make today count.'; }
  else if (!visibleTasks.length) { $('#empty-title').textContent = currentFilter === 'active' ? 'All caught up.' : 'Nothing here yet.'; $('#empty-copy').textContent = currentFilter === 'active' ? 'You’ve completed every task. Enjoy the breathing room.' : 'Completed tasks will show up here.'; }

  document.querySelectorAll('[data-filter]').forEach(button => {
    const active = button.dataset.filter === currentFilter;
    button.classList.toggle('selected', active);
    if (button.classList.contains('nav-item')) button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function setFilter(filter) { currentFilter = filter; render(); }

function updateTaskTimers() {
  document.querySelectorAll('[data-task-timer]').forEach(timer => {
    const task = tasks.find(item => item.id === timer.dataset.taskTimer);
    if (!task || task.outcome !== 'pending') return;
    const remaining = remainingTime(task);
    timer.textContent = `◷ ${formatTimer(remaining)}`;
    timer.classList.toggle('timer-urgent', remaining < 60_000);
  });
}

function isToday(value) {
  const date = new Date(value), now = new Date();
  return !Number.isNaN(date.valueOf()) && date.toDateString() === now.toDateString();
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const activeMember = hasActiveMembership(rewards);
  if (!activeMember && rewards.trialTasksUsed >= FREE_TASK_LIMIT) { showNotice('Your 10 free tasks are used. Activate the ₹99 demo membership to keep going.'); return; }
  if (!input.value.trim()) { input.focus(); return; }
  const selectedDuration = durationInput.value === 'custom' ? Number(customDurationInput.value) : Number(durationInput.value);
  if (!Number.isInteger(selectedDuration) || selectedDuration < 1 || selectedDuration > 1440) {
    showNotice('Choose a custom timer from 1 minute to 24 hours.', 'failure');
    customDurationInput.focus();
    return;
  }
  tasks = addTask(tasks, input.value, new Date(), selectedDuration);
  if (!activeMember) rewards = { ...rewards, trialTasksUsed: rewards.trialTasksUsed + 1 };
  currentFilter = 'all';
  input.value = '';
  saveTasks(); saveRewards(); render(); input.focus();
});

$('#membership-button').addEventListener('click', () => {
  rewards = extendDemoMembership(rewards);
  saveRewards();
  render();
  showNotice('Demo membership active for one month. No payment was charged.', 'success');
});

durationInput.addEventListener('change', () => {
  const customSelected = durationInput.value === 'custom';
  customDurationInput.hidden = !customSelected;
  customDurationInput.required = customSelected;
  if (customSelected) customDurationInput.focus();
});

document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => setFilter(button.dataset.filter)));
$('#clear-completed').addEventListener('click', () => { tasks = clearCompleted(tasks); saveTasks(); render(); });
window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY) tasks = loadTasks(window.localStorage);
  if (event.key === REWARDS_KEY) rewards = loadRewards(window.localStorage);
  if (event.key === STORAGE_KEY || event.key === REWARDS_KEY) render();
});

settleExpiredTasks();
render();
window.setInterval(() => {
  if (settleExpiredTasks()) render();
  else updateTaskTimers();
}, 1000);


