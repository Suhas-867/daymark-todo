import { STORAGE_KEY, addTask, clearCompleted, deleteTask, filterTasks, loadTasks, progress, toggleTask } from './tasks.js';

const $ = selector => document.querySelector(selector);
const list = $('#task-list');
const form = $('#task-form');
const input = $('#task-input');
const emptyState = $('#empty-state');
let tasks = loadTasks(window.localStorage);
let currentFilter = 'all';

$('#today-label').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());

function save() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch {
    // The app remains usable for this session when browser storage is unavailable.
  }
}

function render() {
  const visibleTasks = filterTasks(tasks, currentFilter);
  const counts = progress(tasks);
  const open = counts.total - counts.completed;
  $('#all-count').textContent = counts.total;
  $('#active-count').textContent = open;
  $('#completed-count').textContent = counts.completed;
  $('#heading-count').textContent = visibleTasks.length;
  $('#list-summary').innerHTML = `YOUR TASKS <span class="toolbar-dot">·</span> ${visibleTasks.length} ${visibleTasks.length === 1 ? 'ITEM' : 'ITEMS'}`;
  $('#progress-percent').textContent = `${counts.percent}%`;
  $('#progress-fraction').textContent = `${counts.completed} of ${counts.total} done`;
  $('#progress-bar').style.width = `${counts.percent}%`;
  $('#progress-bar').parentElement.setAttribute('aria-label', `${counts.percent}% complete`);
  $('#progress-message').textContent = counts.total && counts.completed === counts.total ? 'Everything is wrapped up. Lovely.' : counts.completed ? 'Look at you, making progress.' : 'Every journey starts somewhere.';
  $('#clear-completed').hidden = counts.completed === 0;
  $('#list-heading').innerHTML = `${currentFilter === 'active' ? 'In progress' : currentFilter === 'completed' ? 'Completed' : 'All tasks'} <span>${visibleTasks.length}</span>`;

  list.replaceChildren(...visibleTasks.map(task => {
    const row = document.createElement('li');
    row.className = `task-row${task.completed ? ' is-complete' : ''}`;
    const check = document.createElement('input');
    check.className = 'check-button'; check.type = 'checkbox'; check.checked = task.completed;
    check.setAttribute('aria-label', `${task.completed ? 'Mark as in progress' : 'Mark as complete'}: ${task.title}`);
    check.addEventListener('change', () => { tasks = toggleTask(tasks, task.id); save(); render(); });
    const title = document.createElement('span'); title.className = 'task-title'; title.textContent = task.title;
    const date = document.createElement('span'); date.className = `task-date${isToday(task.createdAt) ? ' today' : ''}`; date.textContent = isToday(task.createdAt) ? 'Today' : formatDate(task.createdAt);
    const remove = document.createElement('button'); remove.className = 'delete-button'; remove.type = 'button'; remove.textContent = '×'; remove.title = 'Delete task'; remove.setAttribute('aria-label', `Delete: ${task.title}`);
    remove.addEventListener('click', () => { tasks = deleteTask(tasks, task.id); save(); render(); });
    row.append(check, title, date, remove);
    return row;
  }));

  emptyState.hidden = visibleTasks.length > 0;
  if (!tasks.length) { $('#empty-title').textContent = 'A fresh start.'; $('#empty-copy').textContent = 'Add your first task and make today count.'; }
  else if (!visibleTasks.length) { $('#empty-title').textContent = currentFilter === 'active' ? 'All caught up.' : 'Nothing here yet.'; $('#empty-copy').textContent = currentFilter === 'active' ? 'You’ve completed every task. Enjoy the breathing room.' : 'Completed tasks will show up here.'; }
  document.querySelectorAll('[data-filter]').forEach(button => {
    const active = button.dataset.filter === currentFilter;
    button.classList.toggle('selected', active);
    if (button.classList.contains('nav-item')) button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function setFilter(filter) {
  currentFilter = filter;
  render();
}

function isToday(value) {
  const date = new Date(value), now = new Date();
  return date.toDateString() === now.toDateString();
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

form.addEventListener('submit', event => {
  event.preventDefault();
  if (!input.value.trim()) { input.focus(); return; }
  tasks = addTask(tasks, input.value);
  currentFilter = 'all';
  input.value = '';
  save(); render(); input.focus();
});
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => setFilter(button.dataset.filter)));
$('#clear-completed').addEventListener('click', () => { tasks = clearCompleted(tasks); save(); render(); });
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY) return;
  tasks = loadTasks(window.localStorage);
  render();
});
render();
