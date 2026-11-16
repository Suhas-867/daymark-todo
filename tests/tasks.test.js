import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, addTask, clearCompleted, createTask, deleteTask, filterTasks, loadTasks, progress, toggleTask } from '../tasks.js';

const sample = [
  { id: 'a', title: 'Plan the day', completed: false, createdAt: '2026-11-16T08:00:00.000Z' },
  { id: 'b', title: 'Send the report', completed: true, createdAt: '2026-11-15T08:00:00.000Z' }
];

test('creates tasks with trimmed titles and an incomplete state', () => {
  const task = createTask('  Read a chapter  ', new Date('2026-11-16T10:00:00.000Z'));
  assert.equal(task.title, 'Read a chapter');
  assert.equal(task.completed, false);
  assert.equal(task.createdAt, '2026-11-16T10:00:00.000Z');
  assert.ok(task.id);
});

test('rejects blank task titles and adds new tasks at the front', () => {
  assert.throws(() => createTask('   '), /cannot be empty/);
  const result = addTask(sample, 'Call home', new Date('2026-11-16T10:00:00.000Z'));
  assert.equal(result.length, 3);
  assert.equal(result[0].title, 'Call home');
  assert.equal(sample.length, 2);
});

test('toggles a task without changing other tasks', () => {
  const result = toggleTask(sample, 'a');
  assert.equal(result[0].completed, true);
  assert.equal(result[1].completed, true);
  assert.equal(sample[0].completed, false);
});

test('deletes and clears completed tasks', () => {
  assert.deepEqual(deleteTask(sample, 'a').map(task => task.id), ['b']);
  assert.deepEqual(clearCompleted(sample).map(task => task.id), ['a']);
});

test('filters tasks and calculates progress', () => {
  assert.deepEqual(filterTasks(sample, 'all').map(task => task.id), ['a', 'b']);
  assert.deepEqual(filterTasks(sample, 'active').map(task => task.id), ['a']);
  assert.deepEqual(filterTasks(sample, 'completed').map(task => task.id), ['b']);
  assert.deepEqual(filterTasks(sample, 'unknown').map(task => task.id), ['a', 'b']);
  assert.deepEqual(progress(sample), { completed: 1, total: 2, percent: 50 });
  assert.deepEqual(progress([]), { completed: 0, total: 0, percent: 0 });
});

test('loads saved tasks and safely handles malformed storage', () => {
  const storage = { getItem: key => key === STORAGE_KEY ? JSON.stringify([...sample, { id: 'bad' }]) : null };
  assert.equal(loadTasks(storage).length, 2);
  assert.deepEqual(loadTasks({ getItem: () => '{' }), []);
  assert.deepEqual(loadTasks({ getItem: () => 'null' }), []);
});
