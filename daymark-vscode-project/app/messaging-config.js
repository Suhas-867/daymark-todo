// Public messaging settings. These identifiers are meant to be visible in a web page.
// NEVER put private keys, SMTP passwords or Twilio tokens in this file.
//
// Email is delivered through EmailJS (https://www.emailjs.com). The EmailJS template should use the
// variables {{to_email}}, {{name}}, {{time}}, {{message}} and optionally {{subject}}.
export const emailConfig = Object.freeze({
  serviceId: 'service_onho0dq',
  templateId: 'template_h0pzjy7',
  publicKey: 'XwCxvFqpibWyJfuoG',
  senderName: 'Daymark'
});

// SMS needs a server-side relay that holds the provider secret (see SETUP.md). Until a relay URL is
// set, text reminders are simulated and shown in the admin outbox.
export const smsConfig = Object.freeze({ relayUrl: '' });

// Safety limits that protect the free EmailJS quota (200 requests per month).
export const emailLimits = Object.freeze({
  codeCooldownSeconds: 60,
  codesPerHour: 5,
  codeLifetimeMinutes: 10,
  maxCodeAttempts: 5,
  remindersPerDay: 20
});
