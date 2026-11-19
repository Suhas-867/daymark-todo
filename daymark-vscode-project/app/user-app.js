// The signed-in Daymark dashboard. It is backend-agnostic: demo mode and Firebase mode each
// supply an adapter with the same small interface (see demo-backend.js / cloud-backend.js).
//
// adapter = {
//   mode: 'demo' | 'cloud',
//   subscribe(listener) -> unsubscribe        listener({ tasks, session, profile })
//   createTask({ title, durationMinutes }), activateMembership() -> { expiresAt, alreadyActive },
//   submitProof({ task, file, mode }), expireTask(task), deleteTask(task),
//   savePreferences(prefs) -> profile, sendReminder(task) -> [{channel, to}], signOut()
// }
import { FREE_TASK_LIMIT } from './rewards.js';

const $ = selector => document.querySelector(selector);
const pad = value => String(value).padStart(2, '0');

export const warnWindowMs = durationMinutes => Math.min(5 * 60_000, Math.max(10_000, durationMinutes * 60_000 * 0.25));
export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
const dateText = (ms, long = false) => ms ? new Intl.DateTimeFormat(undefined, long ? { day: 'numeric', month: 'short', year: 'numeric' } : { month: 'short', day: 'numeric' }).format(new Date(ms)) : '';
const parseMs = value => (typeof value === 'number' ? value : Date.parse(value || ''));

export function startUserApp(adapter) {
  const list = $('#task-list'), form = $('#task-form'), input = $('#task-input');
  let state = { tasks: [], session: { points: 0, earnedRupees: 0, membershipExpiresAt: null }, profile: {} };
  let filter = 'all', proofTask = null, overlayTimer;
  const seen = new Map(), expiring = new Set(), warned = new Set();
  let firstSnapshot = true, lastRupees = 0;

  /* ---------- small UI helpers ---------- */
  function toast({ title, body = '', kind = 'info', timeout = 7000 }) {
    const el = document.createElement('div'); el.className = `toast toast-${kind}`; el.setAttribute('role', kind === 'warn' ? 'alert' : 'status');
    const strong = document.createElement('strong'); strong.textContent = title; el.append(strong);
    if (body) { const p = document.createElement('p'); p.textContent = body; el.append(p); }
    const close = document.createElement('button'); close.type = 'button'; close.className = 'toast-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Dismiss'); el.append(close);
    const remove = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 220); };
    close.addEventListener('click', remove); if (timeout) setTimeout(remove, timeout);
    $('#toast-stack').append(el);
  }
  function celebrate(message, kind) {
    window.clearTimeout(overlayTimer);
    const overlay = $('#outcome-overlay'); $('#outcome-message').textContent = message;
    overlay.className = `outcome-overlay outcome-${kind}`; overlay.hidden = false;
    overlayTimer = window.setTimeout(() => { overlay.hidden = true; }, 4200);
    overlay.onclick = () => { overlay.hidden = true; };
  }
  function systemNotification(title, body) {
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, tag: title }); } catch { /* optional */ }
  }
  const messageOf = error => error?.message || 'Something went wrong. Please try again.';

  /* ---------- status model ---------- */
  const isOpen = task => task.status === 'pending' || task.status === 'review';
  const isRunning = task => task.status === 'pending' && parseMs(task.deadlineAt) > Date.now();
  function statusLabel(task) {
    switch (task.status) {
      case 'approved': return { text: 'Approved · +100 pts', tone: 'ok' };
      case 'failed': return { text: 'Time expired · −500 pts', tone: 'bad' };
      case 'review': return task.reviewMode === 'ai' && task.aiState === 'analyzing' ? { text: 'AI is reviewing…', tone: 'busy' } : { text: task.reviewMode === 'ai' ? 'AI unsure · waiting for admin' : 'Waiting for admin review', tone: 'wait' };
      default: return null;
    }
  }

  /* ---------- rendering ---------- */
  function render() {
    const { tasks, session, profile } = state, now = Date.now();
    const done = tasks.filter(task => task.status === 'approved').length, open = tasks.filter(isOpen).length;
    const percent = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    const trialUsed = profile.trialTasksUsed || 0, trialLeft = Math.max(0, FREE_TASK_LIMIT - trialUsed);
    const member = parseMs(session.membershipExpiresAt) > now, locked = !member && trialLeft === 0;
    const points = session.points || 0, milestone = ((points % 1000) + 1000) % 1000;

    $('#all-count').textContent = tasks.length; $('#active-count').textContent = open; $('#completed-count').textContent = done;
    $('#progress-percent').textContent = `${percent}%`; $('#progress-fraction').textContent = `${done} of ${tasks.length} done`; $('#progress-bar').style.width = `${percent}%`;
    $('#points-total').textContent = points.toLocaleString();
    $('#milestone-copy').textContent = `${milestone.toLocaleString()} / 1,000 to next reward`;
    $('#milestone-bar').style.width = `${milestone / 10}%`; $('#milestone-bar').parentElement.setAttribute('aria-valuenow', String(milestone));
    $('#reward-total').textContent = `₹${session.earnedRupees || 0}`;

    $('#membership-status').textContent = member ? 'Active' : trialLeft ? `Free trial · ${trialLeft} left` : 'Trial finished';
    $('#membership-expiry').textContent = member ? `Active until ${dateText(parseMs(session.membershipExpiresAt), true)}` : trialLeft ? `${trialLeft} of ${FREE_TASK_LIMIT} free timed tasks remaining.` : 'Get membership to add more tasks.';
    $('#membership-button').textContent = member ? 'Extend membership' : 'Activate membership · ₹99';
    for (const control of [input, $('#task-duration'), $('#custom-duration'), $('#task-add')]) control.disabled = locked;
    form.classList.toggle('membership-locked', locked); $('#trial-lock-message').hidden = !locked;
    input.placeholder = locked ? 'Membership required to add tasks' : 'What will you get done?';

    const shown = tasks.filter(task => filter === 'all' || (filter === 'active' && isOpen(task)) || (filter === 'completed' && task.status === 'approved'));
    $('#list-summary').textContent = `${shown.length} ${shown.length === 1 ? 'task' : 'tasks'}`;
    $('#list-heading').innerHTML = `${filter === 'active' ? 'In progress' : filter === 'completed' ? 'Completed' : 'All tasks'} <span>${shown.length}</span>`;
    $('#clear-completed').hidden = done === 0;
    list.replaceChildren(...shown.map(taskRow));
    $('#empty-state').hidden = shown.length > 0;
    $('#empty-title').textContent = tasks.length ? (filter === 'completed' ? 'Nothing completed yet' : 'All caught up') : 'No tasks yet';
    $('#empty-copy').textContent = tasks.length ? (filter === 'completed' ? 'Approved tasks will show up here.' : 'Nothing is in progress right now.') : 'Add a task, pick a timer and start the clock.';
    document.querySelectorAll('[data-filter]').forEach(button => {
      const on = button.dataset.filter === filter; button.classList.toggle('selected', on); button.setAttribute('aria-pressed', String(on));
      if (button.classList.contains('nav-item')) button.classList.toggle('active', on);
    });

    const name = profile.name || profile.email || profile.phone || 'My account';
    $('#user-name').textContent = name; $('#user-contact').textContent = profile.email || profile.phone || ''; $('#user-avatar').textContent = (name.trim()[0] || 'D').toUpperCase();
    const hour = new Date().getHours(), greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    $('#greeting').textContent = profile.name ? `${greet}, ${profile.name.split(' ')[0]}` : greet;
    const setState = (id, on) => { const el = $(id); el.textContent = on ? 'On' : 'Off'; el.className = on ? 'state-on' : 'state-off'; };
    setState('#reminder-email-state', profile.emailReminders); setState('#reminder-sms-state', profile.smsReminders);
    const any = profile.emailReminders || profile.smsReminders;
    $('#reminder-note').textContent = any ? 'You will be warned shortly before a timer ends.' : 'Turn on reminders to be warned before a timer runs out. Pop-ups in this app are always on.';
    $('#reminder-enable').textContent = any ? 'Manage reminders' : 'Enable reminders'; $('#reminder-enable').className = any ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm';
  }

  function taskRow(task) {
    const row = document.createElement('li'), running = isRunning(task), label = statusLabel(task);
    row.className = `task-row${running ? ' is-running' : ''}${task.status === 'approved' ? ' is-complete' : ''}${task.status === 'failed' ? ' is-missed' : ''}${task.status === 'review' ? ' is-review' : ''}`;
    const icon = document.createElement('span'); icon.className = 'task-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = task.status === 'approved' ? '✓' : task.status === 'failed' ? '!' : task.status === 'review' ? '◐' : '◔';
    const main = document.createElement('div'); main.className = 'task-main';
    const title = document.createElement('span'); title.className = 'task-title'; title.textContent = task.title;
    const meta = document.createElement('span'); meta.className = 'task-meta'; meta.textContent = `${dateText(parseMs(task.createdAt))} · ${task.durationMinutes >= 60 && task.durationMinutes % 60 === 0 ? `${task.durationMinutes / 60} hr` : `${task.durationMinutes} min`} timer`;
    main.append(title, meta);
    const note = task.status === 'review' || task.status === 'pending' ? task.reviewReason : (task.status === 'approved' ? task.reviewReason : '');
    if (note) { const p = document.createElement('span'); p.className = `task-note${task.status === 'pending' ? ' note-warn' : ''}`; p.textContent = task.status === 'pending' ? `Last proof not accepted: ${note}` : note; main.append(p); }
    const timer = document.createElement('span');
    if (running) { timer.className = 'task-timer'; timer.dataset.deadline = String(parseMs(task.deadlineAt)); timer.dataset.taskId = task.id; timer.textContent = formatClock(parseMs(task.deadlineAt) - Date.now()); }
    else if (label) { timer.className = `task-badge badge-${label.tone}`; timer.textContent = label.text; }
    else { timer.className = 'task-badge badge-bad'; timer.textContent = 'Time expired'; }
    const actions = document.createElement('div'); actions.className = 'task-actions';
    if (running) { const proof = document.createElement('button'); proof.type = 'button'; proof.className = 'btn btn-primary btn-sm'; proof.textContent = 'Submit proof'; proof.addEventListener('click', () => openProof(task)); actions.append(proof); }
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-btn'; remove.textContent = '×'; remove.title = 'Delete task'; remove.setAttribute('aria-label', `Delete: ${task.title}`);
    remove.addEventListener('click', async () => { try { await adapter.deleteTask(task); } catch (error) { toast({ title: 'Could not delete', body: messageOf(error), kind: 'warn' }); } });
    actions.append(remove);
    row.append(icon, main, timer, actions);
    return row;
  }

  /* ---------- reacting to changes (from this tab, the admin site or the AI) ---------- */
  function detectTransitions(next) {
    for (const task of next.tasks) {
      const before = seen.get(task.id);
      if (before && before !== task.status) {
        if (task.status === 'approved') celebrate('CONGRATULATIONS!! YOU HAVE COMPLETED THE TASK!! +100 POINTS 🎉', 'success');
        else if (task.status === 'failed') celebrate('OOPS! THE TIMER HAS RUN OUT...BETTER LUCK NEXT TIME!', 'failure');
        else if (before === 'review' && task.status === 'pending') toast({ title: 'Proof not accepted', body: `${task.reviewReason || 'Please upload a clearer photo.'} You can submit again before the timer ends.`, kind: 'warn', timeout: 10000 });
        else if (task.status === 'review' && before === 'pending') { /* submitted: dialog already confirmed it */ }
      }
      seen.set(task.id, task.status);
    }
    const rupees = next.session.earnedRupees || 0;
    if (!firstSnapshot && rupees > lastRupees) toast({ title: 'Milestone reached!', body: `You hit another 1,000 points: +₹${rupees - lastRupees} demo reward.`, kind: 'success', timeout: 9000 });
    lastRupees = rupees; firstSnapshot = false;
  }
  adapter.subscribe(next => { detectTransitions(next); state = next; render(); });

  /* ---------- clock: timers, expiry and reminders ---------- */
  async function tick() {
    for (const task of state.tasks) {
      if (task.status !== 'pending') continue;
      const left = parseMs(task.deadlineAt) - Date.now();
      if (left <= 0) {
        if (!expiring.has(task.id)) { expiring.add(task.id); try { await adapter.expireTask(task); } catch (error) { console.error(error); expiring.delete(task.id); } }
      } else if (left <= warnWindowMs(task.durationMinutes) && !warned.has(task.id)) {
        warned.add(task.id);
        const minutes = Math.max(1, Math.ceil(left / 60_000)), wording = left < 60_000 ? `${Math.ceil(left / 1000)} seconds` : `${minutes} minute${minutes === 1 ? '' : 's'}`;
        toast({ title: '⏰ Time is running out!', body: `“${task.title}” has about ${wording} left. Finish it and submit proof now.`, kind: 'warn', timeout: 14000 });
        systemNotification('Daymark: time is running out', `“${task.title}” has about ${wording} left.`);
        try {
          const sent = await adapter.sendReminder(task);
          for (const message of sent || []) toast({ title: message.channel === 'email' ? '📧 Reminder email sent' : '💬 Reminder text sent', body: `${message.to}${adapter.mode === 'demo' ? ' (simulated in demo mode)' : ''}`, kind: 'info', timeout: 8000 });
        } catch (error) { console.error(error); }
      }
    }
    document.querySelectorAll('.task-timer[data-deadline]').forEach(el => {
      const left = Number(el.dataset.deadline) - Date.now();
      if (left <= 0) return; // the snapshot after expiry re-renders this row
      el.textContent = formatClock(left); el.classList.toggle('timer-urgent', left < 60_000);
    });
  }
  window.setInterval(tick, 1000);

  /* ---------- task form, membership, filters ---------- */
  $('#task-duration').addEventListener('change', () => { const custom = $('#task-duration').value === 'custom'; $('#custom-duration').hidden = !custom; $('#custom-duration').required = custom; if (custom) $('#custom-duration').focus(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const title = input.value.trim(), minutes = $('#task-duration').value === 'custom' ? Number($('#custom-duration').value) : Number($('#task-duration').value);
    if (!title) { input.focus(); return; }
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) { toast({ title: 'Custom timer', body: 'Choose a timer from 1 minute to 24 hours (1440 minutes).', kind: 'warn' }); $('#custom-duration').focus(); return; }
    $('#task-add').disabled = true;
    try { await adapter.createTask({ title, durationMinutes: minutes }); input.value = ''; filter = 'all'; input.focus(); }
    catch (error) { toast({ title: 'Task not added', body: messageOf(error), kind: 'warn' }); }
    finally { render(); }
  });
  $('#membership-button').addEventListener('click', async () => {
    try {
      const result = await adapter.activateMembership(), until = dateText(parseMs(result.expiresAt), true);
      toast({ title: result.alreadyActive ? 'Membership already active' : 'Membership active', body: result.alreadyActive ? `Your plan stays active until ${until}. Extending does not move the date during this session.` : `Active until ${until}. Demo only: no payment was charged.`, kind: 'success' });
    } catch (error) { toast({ title: 'Membership', body: messageOf(error), kind: 'warn' }); }
  });
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; render(); }));
  $('#clear-completed').addEventListener('click', async () => { for (const task of state.tasks.filter(item => item.status === 'approved')) { try { await adapter.deleteTask(task); } catch (error) { toast({ title: 'Could not clear', body: messageOf(error), kind: 'warn' }); break; } } });

  /* ---------- proof dialog ---------- */
  const proofDialog = $('#proof-dialog'), proofFile = $('#proof-file');
  function resetPreview() { $('#proof-preview').hidden = true; $('#proof-preview').removeAttribute('src'); $('#proof-drop-text').hidden = false; }
  function openProof(task) {
    proofTask = task; $('#proof-task-title').textContent = task.title; proofFile.value = ''; resetPreview(); $('#proof-status').textContent = ''; $('#proof-status').className = 'dialog-status';
    $('#proof-submit').disabled = false; proofDialog.showModal();
  }
  proofFile.addEventListener('change', () => {
    const file = proofFile.files[0]; if (!file) { resetPreview(); return; }
    const url = URL.createObjectURL(file), preview = $('#proof-preview'); preview.onload = () => URL.revokeObjectURL(url); preview.src = url; preview.hidden = false; $('#proof-drop-text').hidden = true;
  });
  $('#proof-close').addEventListener('click', () => proofDialog.close());
  $('#proof-form').addEventListener('submit', async event => {
    event.preventDefault();
    const file = proofFile.files[0], status = $('#proof-status'), button = $('#proof-submit');
    const fail = message => { status.textContent = message; status.className = 'dialog-status is-error'; };
    if (!proofTask) return;
    if (!file) return fail('Choose a photo first.');
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return fail('Use a JPG, PNG or WebP image.');
    if (file.size > 8 * 1024 * 1024) return fail('That image is larger than 8 MB.');
    const mode = document.querySelector('input[name="proof-mode"]:checked').value;
    button.disabled = true; status.textContent = 'Uploading…'; status.className = 'dialog-status';
    try {
      await adapter.submitProof({ task: proofTask, file, mode });
      proofDialog.close();
      toast({ title: mode === 'ai' ? 'Proof sent for AI review' : 'Proof sent to the admin queue', body: mode === 'ai' ? 'The AI is checking your photo now. Unclear photos go to an admin.' : 'An admin will review it and award your points.', kind: 'success' });
    } catch (error) { fail(messageOf(error)); button.disabled = false; }
  });

  /* ---------- settings dialog ---------- */
  const settings = $('#settings-dialog');
  function notifyLabel() {
    const supported = 'Notification' in window, permission = supported ? Notification.permission : 'unsupported';
    $('#notify-state').textContent = !supported ? 'Not supported by this browser.' : permission === 'granted' ? 'Allowed. A pop-up appears when time is running out.' : permission === 'denied' ? 'Blocked in your browser settings.' : 'Show a system notification when time is running out.';
    $('#notify-enable').hidden = !supported || permission !== 'default';
  }
  function openSettings() {
    const profile = state.profile;
    $('#set-name').value = profile.name || ''; $('#set-email').value = profile.email || ''; $('#set-phone').value = profile.phone || '';
    $('#set-email-consent').checked = Boolean(profile.emailReminders); $('#set-sms-consent').checked = Boolean(profile.smsReminders);
    $('#settings-status').textContent = ''; $('#settings-status').className = 'dialog-status'; notifyLabel(); settings.showModal();
  }
  for (const id of ['#account-button', '#topbar-settings', '#reminder-enable']) $(id).addEventListener('click', openSettings);
  $('#settings-close').addEventListener('click', () => settings.close());
  $('#notify-enable').addEventListener('click', async () => { try { await Notification.requestPermission(); } catch { /* ignored */ } notifyLabel(); });
  $('#signout-button').addEventListener('click', () => { settings.close(); adapter.signOut(); });
  $('#settings-form').addEventListener('submit', async event => {
    event.preventDefault(); const status = $('#settings-status'), button = $('#settings-save'); button.disabled = true;
    try {
      await adapter.savePreferences({ name: $('#set-name').value, email: $('#set-email').value, phone: $('#set-phone').value, emailReminders: $('#set-email-consent').checked, smsReminders: $('#set-sms-consent').checked });
      status.textContent = 'Preferences saved.'; status.className = 'dialog-status is-ok'; setTimeout(() => settings.close(), 700);
    } catch (error) { status.textContent = messageOf(error); status.className = 'dialog-status is-error'; }
    finally { button.disabled = false; }
  });

  $('#today-label').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  $('#demo-banner').hidden = adapter.mode !== 'demo';
  render();
}
