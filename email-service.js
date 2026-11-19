// Sends real email through the EmailJS REST API straight from the browser.
// Only the public key is used. On localhost EmailJS rejects the request (its allowed-domain list
// covers the published site), so local development skips delivery and reports it.
import { emailConfig } from './messaging-config.js';

const ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '']);

export function isLocalHost(hostname = globalThis.location?.hostname ?? '') { return LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost'); }

export function buildEmailRequest({ to, name = '', subject = '', message, time = new Date().toLocaleString() }, config = emailConfig) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(to || ''))) throw new Error('A valid recipient email address is required.');
  if (!String(message || '').trim()) throw new Error('The email needs a message.');
  return {
    service_id: config.serviceId, template_id: config.templateId, user_id: config.publicKey,
    template_params: { to_email: to, name: name || config.senderName, subject, time, message: String(message).slice(0, 1500) }
  };
}

/**
 * @returns {Promise<{delivered:boolean, simulated:boolean}>}
 * Rejects with a readable message when EmailJS refuses the request.
 */
export async function sendEmail(details, { config = emailConfig, fetchImpl = globalThis.fetch, hostname } = {}) {
  const request = buildEmailRequest(details, config);
  if (isLocalHost(hostname)) return { delivered: false, simulated: true };
  let response;
  try {
    response = await fetchImpl(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  } catch { throw new Error('Could not reach the email service. Check your connection.'); }
  if (response.ok) return { delivered: true, simulated: false };
  const text = (await response.text().catch(() => '')).trim();
  if (response.status === 429) throw new Error('The email service is rate limited right now. Try again later.');
  throw new Error(text ? `Email service: ${text.slice(0, 160)}` : `Email service error (${response.status}).`);
}
