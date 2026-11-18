export const STORAGE_KEY = 'daymark.tasks.v1';

export function createTask(title, now = new Date(), durationMinutes = 25) {
  const cleaned = String(title).trim();
  if (!cleaned) throw new Error('Task title cannot be empty.');
  const duration = Number(durationMinutes);
  if (!Number.isFinite(duration) || duration < 1 || duration > 1440) throw new Error('Choose a timer from 1 to 1440 minutes.');
  return {
    id: makeId(), title: cleaned, completed: false, createdAt: now.toISOString(),
    durationMinutes: duration, deadlineAt: new Date(now.getTime() + duration * 60_000).toISOString(), outcome: 'pending'
  };
}

export function addTask(tasks, title, now, durationMinutes) {
  return [createTask(title, now, durationMinutes), ...tasks];
}

export function toggleTask(tasks, id) {
  return tasks.map(task => task.id === id ? { ...task, completed: !task.completed } : task);
}

export function completeTimedTask(tasks, id, now = new Date()) {
  let pointsDelta = 0;
  const updated = tasks.map(task => {
    if (task.id !== id || task.outcome !== 'pending' || task.completed) return task;
    const deadline = Date.parse(task.deadlineAt);
    const onTime = Number.isFinite(deadline) && now.getTime() < deadline;
    pointsDelta = onTime ? 100 : -100;
    return { ...task, completed: true, outcome: onTime ? 'success' : 'late' };
  });
  return { tasks: updated, pointsDelta };
}

export function failExpiredTasks(tasks, now = new Date()) {
  const failedIds = [];
  const updated = tasks.map(task => {
    if (task.outcome !== 'pending' || task.completed) return task;
    const deadline = Date.parse(task.deadlineAt);
    if (!Number.isFinite(deadline) || now.getTime() < deadline) return task;
    failedIds.push(task.id);
    return { ...task, outcome: 'failed' };
  });
  return { tasks: updated, failedIds, pointsDelta: failedIds.length * -100 };
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
    return parsed.filter(task => task && typeof task.id === 'string' && typeof task.title === 'string' && typeof task.completed === 'boolean').map(task => ({
      ...task,
      outcome: ['pending', 'success', 'late', 'failed'].includes(task.outcome) ? task.outcome : 'legacy',
      durationMinutes: Number.isFinite(Number(task.durationMinutes)) ? Number(task.durationMinutes) : null,
      deadlineAt: typeof task.deadlineAt === 'string' ? task.deadlineAt : null
    }));
  } catch {
    return [];
  }
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
