// Sends text messages through a small server-side relay (see worker/). The relay holds the Twilio
// secrets; this page only knows the relay's public URL. Without a relay URL, or on localhost,
// delivery is skipped and reported as simulated.
import { smsConfig } from './messaging-config.js';
import { isLocalHost } from './email-service.js';

export const smsReady = (config = smsConfig) => Boolean(config.relayUrl);

/** kind: 'otp' (needs code) or 'reminder' (needs title). The relay writes the final wording itself. */
export function buildSmsRequest({ to, kind, code = '', title = '' }) {
  if (!/^\+[1-9]\d{7,14}$/.test(String(to || ''))) throw new Error('A phone number with country code is required.');
  if (kind === 'otp') {
    if (!/^\d{6}$/.test(String(code))) throw new Error('A 6-digit code is required.');
    return { to, kind, code: String(code) };
  }
  if (kind === 'reminder') {
    const clean = String(title).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60);
    if (!clean) throw new Error('A task title is required.');
    return { to, kind, title: clean };
  }
  throw new Error('Unknown text message type.');
}

/** @returns {Promise<{delivered:boolean, simulated:boolean, sid?:string}>} */
export async function sendSms(details, { config = smsConfig, fetchImpl = globalThis.fetch, hostname } = {}) {
  const request = buildSmsRequest(details);
  if (!smsReady(config) || isLocalHost(hostname)) return { delivered: false, simulated: true };
  let response;
  try {
    response = await fetchImpl(config.relayUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  } catch { throw new Error('Could not reach the text message service. Check your connection.'); }
  const body = await response.json().catch(() => ({}));
  if (response.ok && body.ok) return { delivered: true, simulated: false, sid: body.sid };
  throw new Error(String(body.error || `Text message service error (${response.status}).`).slice(0, 200));
}
