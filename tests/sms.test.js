import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSmsRequest, sendSms, smsReady } from '../sms-service.js';
import { composeMessage, handleRequest } from '../worker/sms-relay.js';

const relay = { relayUrl: 'https://relay.example.workers.dev' };

test('builds only the two allowed text request kinds', () => {
  assert.deepEqual(buildSmsRequest({ to: '+919876543210', kind: 'otp', code: '123456' }), { to: '+919876543210', kind: 'otp', code: '123456' });
  assert.deepEqual(buildSmsRequest({ to: '+919876543210', kind: 'reminder', title: '  Read\nbook  ' }), { to: '+919876543210', kind: 'reminder', title: 'Read book' });
  assert.throws(() => buildSmsRequest({ to: '9876543210', kind: 'otp', code: '123456' }), /country code/);
  assert.throws(() => buildSmsRequest({ to: '+919876543210', kind: 'otp', code: '12' }), /6-digit/);
  assert.throws(() => buildSmsRequest({ to: '+919876543210', kind: 'free-text' }), /Unknown/);
});

test('client simulates without a relay or on localhost, and reports relay errors', async () => {
  const details = { to: '+919876543210', kind: 'otp', code: '123456' };
  assert.equal(smsReady({ relayUrl: '' }), false);
  assert.deepEqual(await sendSms(details, { config: { relayUrl: '' }, hostname: 'x.io' }), { delivered: false, simulated: true });
  assert.deepEqual(await sendSms(details, { config: relay, hostname: 'localhost' }), { delivered: false, simulated: true });
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, sid: 'SM1' }) });
  assert.deepEqual(await sendSms(details, { config: relay, fetchImpl: ok, hostname: 'x.io' }), { delivered: true, simulated: false, sid: 'SM1' });
  const bad = async () => ({ ok: false, status: 502, json: async () => ({ ok: false, error: 'Twilio: unverified number (code 21608)' }) });
  await assert.rejects(sendSms(details, { config: relay, fetchImpl: bad, hostname: 'x.io' }), /unverified number/);
  await assert.rejects(sendSms(details, { config: relay, fetchImpl: async () => { throw new TypeError('x'); }, hostname: 'x.io' }), /Could not reach/);
});

const env = { TWILIO_ACCOUNT_SID: 'ACxxx', TWILIO_AUTH_TOKEN: 'secret-token', TWILIO_FROM: '+14155550100', ALLOWED_ORIGINS: 'https://suhas-867.github.io', ALLOWED_NUMBERS: '+919876543210' };
const call = (body, { origin = 'https://suhas-867.github.io', method = 'POST', environment = env, fetchImpl } = {}) =>
  handleRequest(new Request('https://relay.example/', { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined }), environment, fetchImpl);
const twilioOk = calls => async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ sid: 'SM123' }) }; };

test('relay writes the message itself and never accepts free text', () => {
  assert.match(composeMessage({ kind: 'otp', code: '123456' }), /Daymark code: 123456/);
  assert.match(composeMessage({ kind: 'reminder', title: 'Call "Mom"' }), /Call Mom/);
  assert.equal(composeMessage({ kind: 'otp', code: 'abcdef' }), null);
  assert.equal(composeMessage({ kind: 'custom', body: 'spam' }), null);
});

test('relay sends through Twilio with server-side credentials and CORS for the allowed site', async () => {
  const calls = [];
  const response = await call({ to: '+919876543210', kind: 'otp', code: '654321' }, { fetchImpl: twilioOk(calls) });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, sid: 'SM123' });
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://suhas-867.github.io');
  assert.match(calls[0].url, /Accounts\/ACxxx\/Messages\.json$/);
  assert.equal(calls[0].init.headers.Authorization, `Basic ${btoa('ACxxx:secret-token')}`);
  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get('To'), '+919876543210'); assert.equal(form.get('From'), '+14155550100'); assert.match(form.get('Body'), /654321/);
  assert.ok(!JSON.stringify(await (await call({ to: '+919876543210', kind: 'otp', code: '1' }, { fetchImpl: twilioOk([]) })).json()).includes('secret-token'));
});

test('relay rejects unknown origins, unlisted numbers, bad requests and an unconfigured relay', async () => {
  const never = async () => { throw new Error('Twilio must not be called'); };
  assert.equal((await call({ to: '+919876543210', kind: 'otp', code: '123456' }, { origin: 'https://evil.example', fetchImpl: never })).status, 403);
  assert.equal((await call({ to: '+919999999999', kind: 'otp', code: '123456' }, { fetchImpl: never })).status, 403);
  assert.equal((await call({ to: '+919876543210', kind: 'custom', body: 'hi' }, { fetchImpl: never })).status, 400);
  assert.equal((await call({ to: '98765', kind: 'otp', code: '123456' }, { fetchImpl: never })).status, 400);
  assert.equal((await call({ to: '+919876543210', kind: 'otp', code: '123456' }, { environment: { ...env, ALLOWED_NUMBERS: '' }, fetchImpl: never })).status, 500);
  assert.equal((await call({ to: '+919876543210', kind: 'otp', code: '123456' }, { environment: { ...env, TWILIO_AUTH_TOKEN: '' }, fetchImpl: never })).status, 500);
  const preflight = await call(null, { method: 'OPTIONS', fetchImpl: never });
  assert.equal(preflight.status, 204); assert.match(preflight.headers.get('Access-Control-Allow-Methods'), /POST/);
  assert.equal((await call(null, { method: 'OPTIONS', origin: 'https://evil.example', fetchImpl: never })).status, 403);
});

test('relay passes on Twilio errors without secrets and applies an hourly limit', async () => {
  const refused = async () => ({ ok: false, json: async () => ({ message: 'The number is unverified. Trial accounts can only text verified numbers.', code: 21608 }) });
  const response = await call({ to: '+919876543210', kind: 'otp', code: '123456' }, { fetchImpl: refused });
  assert.equal(response.status, 502); const body = await response.json();
  assert.match(body.error, /unverified.*21608/); assert.ok(!JSON.stringify(body).includes('secret-token'));
  const store = new Map(), RATE = { get: async key => store.get(key) ?? null, put: async (key, value) => { store.set(key, value); } };
  const limited = { ...env, RATE, HOURLY_LIMIT: '2' };
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await call({ to: '+919876543210', kind: 'otp', code: '123456' }, { environment: limited, fetchImpl: twilioOk([]) })).status);
  assert.deepEqual(statuses, [200, 200, 429]);
});
