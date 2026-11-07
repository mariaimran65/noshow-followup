const { formatET } = require('./time');

function buildMessage(rec) {
  const who = [rec.contactName, rec.company && `(${rec.company})`].filter(Boolean).join(' ');
  const reach = [rec.phone, rec.email].filter(Boolean).join(' · ');
  const text = [
    `:rotating_light: No-show: *${who}* missed their demo with *${rec.closerName}*`,
    `Contact: ${reach || 'n/a'}`,
    `Appointment: ${formatET(rec.startTime)}`,
    `<${rec.rebookUrl}|Rebook>`,
  ].join('\n');
  // `text` is the Slack-standard field; the rest are structured extras for n8n to map.
  return {
    text,
    closer: rec.closerName,
    contact: who,
    phone: rec.phone,
    email: rec.email,
    appointment_time: formatET(rec.startTime),
    rebook_url: rec.rebookUrl,
  };
}

async function postToSlack(url, rec) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildMessage(rec)),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Slack webhook responded ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { buildMessage, postToSlack };
