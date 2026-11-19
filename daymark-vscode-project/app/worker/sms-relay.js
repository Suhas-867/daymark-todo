// Cloudflare Worker: a tiny, locked-down relay between the Daymark web page and Twilio.
// The Twilio secrets live only in the Worker's encrypted settings, never in the web page or GitHub.
//
// Safeguards:
//  - only requests from ALLOWED_ORIGINS are answered (CORS + Origin check)
//  - only numbers listed in ALLOWED_NUMBERS can receive messages (a Twilio trial can only text verified numbers anyway)
//  - the page cannot send arbitrary text: it sends a kind ("otp" or "reminder") and the Worker writes the message
//  - optional per-number hourly limit when a KV namespace is bound as RATE
//
// Settings (Worker -> Settings -> Variables and Secrets):
//   Secrets:  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
//   Text:     TWILIO_FROM (your Twilio number, e.g. +1415...) or TWILIO_MESSAGING_SERVICE_SID
//             ALLOWED_ORIGINS (e.g. https://suhas-867.github.io), ALLOWED_NUMBERS (e.g. +919876543210,+91...)
//   Optional: RATE (KV namespace binding), HOURLY_LIMIT (default 6)

const json = (data, status, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const list = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);

export function composeMessage({ kind, code, title }) {
  if (kind === 'otp') {
    if (!/^\d{6}$/.test(String(code))) return null;
    return `Daymark code: ${code}. It expires in 10 minutes. If you did not ask for it, ignore this message.`;
  }
  if (kind === 'reminder') {
    const clean = String(title || '').replace(/"/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60);
    return clean ? `Daymark: "${clean}" is due soon. Submit proof before the timer ends.` : null;
  }
  return null;
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = list(env.ALLOWED_ORIGINS), originOk = allowedOrigins.includes(origin);
  const cors = originOk ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' } : {};

  if (request.method === 'OPTIONS') return originOk ? new Response(null, { status: 204, headers: cors }) : new Response(null, { status: 403 });
  if (!originOk) return json({ ok: false, error: 'This site is not allowed to use the relay.' }, 403);
  if (request.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405, cors);
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !(env.TWILIO_FROM || env.TWILIO_MESSAGING_SERVICE_SID)) return json({ ok: false, error: 'The relay is not configured yet.' }, 500, cors);
  const allowedNumbers = list(env.ALLOWED_NUMBERS);
  if (!allowedNumbers.length) return json({ ok: false, error: 'No recipient numbers are allowed yet.' }, 500, cors);

  const raw = await request.text();
  if (raw.length > 1024) return json({ ok: false, error: 'Request too large.' }, 413, cors);
  let payload; try { payload = JSON.parse(raw); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400, cors); }
  const to = String(payload?.to || '');
  if (!/^\+[1-9]\d{7,14}$/.test(to)) return json({ ok: false, error: 'Invalid phone number.' }, 400, cors);
  if (!allowedNumbers.includes(to)) return json({ ok: false, error: 'This number is not allowed to receive messages.' }, 403, cors);
  const body = composeMessage(payload);
  if (!body) return json({ ok: false, error: 'Invalid message request.' }, 400, cors);

  if (env.RATE) {
    const limit = Number(env.HOURLY_LIMIT) || 6, key = `rl:${to}:${Math.floor(Date.now() / 3_600_000)}`;
    const used = Number(await env.RATE.get(key)) || 0;
    if (used >= limit) return json({ ok: false, error: 'Too many messages to this number. Try again later.' }, 429, cors);
    await env.RATE.put(key, String(used + 1), { expirationTtl: 3700 });
  }

  const form = new URLSearchParams({ To: to, Body: body });
  if (env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', env.TWILIO_MESSAGING_SERVICE_SID); else form.set('From', env.TWILIO_FROM);
  let twilio;
  try {
    twilio = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Messages.json`, {
      method: 'POST', headers: { Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString()
    });
  } catch { return json({ ok: false, error: 'Could not reach Twilio.' }, 502, cors); }
  const result = await twilio.json().catch(() => ({}));
  if (twilio.ok) return json({ ok: true, sid: result.sid || '' }, 200, cors);
  // Pass on Twilio's explanation (for example an unverified trial number) but never any secret.
  return json({ ok: false, error: `Twilio: ${String(result.message || 'could not send the message').slice(0, 150)}${result.code ? ` (code ${result.code})` : ''}` }, 502, cors);
}

export default { fetch: (request, env) => handleRequest(request, env) };
