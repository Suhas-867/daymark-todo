export const STORAGE_KEY = 'daymark.learning.tasks.v1';

export function createTask(title, now = new Date()) {
  const cleaned = String(title).trim();
  if (!cleaned) throw new Error('Task title cannot be empty.');
  return { id: makeId(), title: cleaned, completed: false, createdAt: now.toISOString() };
}

export function addTask(tasks, title, now) {
  return [createTask(title, now), ...tasks];
}

export function toggleTask(tasks, id) {
  return tasks.map(task => task.id === id ? { ...task, completed: !task.completed } : task);
}

export function deleteTask(tasks, id) {
  return tasks.filter(task => task.id !== id);
}

export function clearCompleted(tasks) {
  return tasks.filter(task => !task.completed);
}

export function filterTasks(tasks, filter) {
  if (filter === 'active') return tasks.filter(task => !task.completed);
  if (filter === 'completed') return tasks.filter(task => task.completed);
  return tasks;
}

export function progress(tasks) {
  const completed = tasks.filter(task => task.completed).length;
  return { completed, total: tasks.length, percent: tasks.length ? Math.round(completed / tasks.length * 100) : 0 };
}

export function loadTasks(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(task => task && typeof task.id === 'string' && typeof task.title === 'string' && typeof task.completed === 'boolean');
  } catch {
    return [];
  }
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
