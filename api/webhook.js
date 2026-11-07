const crypto = require('crypto');
const { getStore } = require('../lib/store');
const { postToSlack } = require('../lib/slack');

const LEASE_MS = 15000;
const DEFAULT_SLACK_URL = 'https://techfektor.app.n8n.cloud/webhook/ai-builder-trial-maria';

// Constant-time secret check (hash first so lengths always match).
function secretOk(provided, expected) {
  if (!provided || !expected) return false;
  const a = crypto.createHash('sha256').update(String(provided)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Auth first: reject before touching the body or storage.
  if (!secretOk(req.headers['x-webhook-secret'], process.env.WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Invalid or missing X-Webhook-Secret' });
  }

  // 2. Validate payload.
  const body = parseBody(req);
  const appt = body && body.appointment;
  const contact = (body && body.contact) || {};
  if (!appt || !appt.id || !appt.appointmentStatus || !appt.startTime) {
    return res.status(400).json({ error: 'Malformed payload: appointment.id, appointmentStatus, startTime required' });
  }

  // 3. Only no-shows trigger follow-up; other updates are acknowledged and ignored.
  if (appt.appointmentStatus !== 'noshow') {
    return res.status(200).json({ ok: true, ignored: true, reason: `status=${appt.appointmentStatus}` });
  }

  // 4. Event identity = appointment + status + start time. A re-delivery of the same event
  //    has the same key. An unrelated edit to the appointment does not re-alert the closer,
  //    but a no-show on a *rebooked* slot (new startTime) is a genuinely new event.
  const key = `${appt.id}|${appt.appointmentStatus}|${appt.startTime}`;
  const record = {
    key,
    receivedAt: new Date().toISOString(),
    appointmentId: appt.id,
    closerId: appt.assignedUserId || 'unassigned',
    closerName: appt.assignedUserName || 'Unassigned closer',
    contactName: [contact.firstName, contact.lastName].filter(Boolean).join(' ') || appt.title || 'Unknown contact',
    company: contact.companyName || '',
    phone: contact.phone || '',
    email: contact.email || '',
    startTime: appt.startTime,
    rebookUrl: body.rebookUrl || '',
    slackPosted: false,
    postingUntil: Date.now() + LEASE_MS, // short lease: "a delivery is posting to Slack right now"
  };

  try {
    const store = getStore();

    // 5. Atomic store + dedupe.
    const inserted = await store.insertIfNew(key, record);
    let target = record;
    if (!inserted) {
      const existing = await store.get(key);
      // Duplicate delivery: do nothing if the first delivery already notified, or is notifying
      // right now (lease still valid). Only take over if its Slack post failed or its lease
      // expired, so a retry can finish the job without ever double-posting.
      if (!existing || existing.slackPosted || existing.postingUntil > Date.now()) {
        return res.status(200).json({ ok: true, duplicate: true });
      }
      target = { ...existing, postingUntil: Date.now() + LEASE_MS };
      await store.update(key, target);
    }

    // 6. Notify. On failure return 502 so the sender retries (the retry hits the branch above).
    try {
      await postToSlack(process.env.SLACK_WEBHOOK_URL || DEFAULT_SLACK_URL, target);
    } catch (err) {
      console.error('slack_post_failed', err.message);
      await store.update(key, { ...target, postingUntil: 0 }); // release the lease so a retry can proceed
      return res.status(502).json({ ok: false, stored: true, error: 'Stored, but Slack notification failed' });
    }
    await store.update(key, { ...target, slackPosted: true });
    return res.status(200).json({ ok: true, stored: true, notified: true });
  } catch (err) {
    console.error('webhook_error', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
