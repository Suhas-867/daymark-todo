import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmailRequest, isLocalHost, sendEmail } from '../email-service.js';

const config = { serviceId: 'svc', templateId: 'tpl', publicKey: 'pub', senderName: 'Daymark' };
const details = { to: 'a@b.co', name: 'Asha', message: 'Hello', time: 'now' };

test('builds an EmailJS request with only public identifiers', () => {
  const request = buildEmailRequest(details, config);
  assert.deepEqual(request, { service_id: 'svc', template_id: 'tpl', user_id: 'pub', template_params: { to_email: 'a@b.co', name: 'Asha', subject: '', time: 'now', message: 'Hello' } });
  assert.throws(() => buildEmailRequest({ ...details, to: 'nope' }, config), /valid recipient/);
  assert.throws(() => buildEmailRequest({ ...details, message: '  ' }, config), /needs a message/);
});

test('detects local development hosts', () => {
  for (const host of ['localhost', '127.0.0.1', 'app.localhost', '']) assert.equal(isLocalHost(host), true);
  assert.equal(isLocalHost('suhas-867.github.io'), false);
});

test('skips delivery on localhost, delivers elsewhere and reports provider errors', async () => {
  let calls = 0;
  const ok = async () => { calls++; return { ok: true, status: 200, text: async () => 'OK' }; };
  assert.deepEqual(await sendEmail(details, { config, fetchImpl: ok, hostname: 'localhost' }), { delivered: false, simulated: true });
  assert.equal(calls, 0);
  assert.deepEqual(await sendEmail(details, { config, fetchImpl: ok, hostname: 'suhas-867.github.io' }), { delivered: true, simulated: false });
  assert.equal(calls, 1);
  const bad = async () => ({ ok: false, status: 400, text: async () => 'The Public Key is invalid.' });
  await assert.rejects(sendEmail(details, { config, fetchImpl: bad, hostname: 'x.io' }), /Public Key is invalid/);
  const limited = async () => ({ ok: false, status: 429, text: async () => '' });
  await assert.rejects(sendEmail(details, { config, fetchImpl: limited, hostname: 'x.io' }), /rate limited/);
  const offline = async () => { throw new TypeError('network'); };
  await assert.rejects(sendEmail(details, { config, fetchImpl: offline, hostname: 'x.io' }), /Could not reach/);
});
