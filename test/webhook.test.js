const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const SECRET = 'trial-secret-7f3a';
process.env.WEBHOOK_SECRET = SECRET;

const { setStore, createMemoryStore } = require('../lib/store');
const webhook = require('../api/webhook');
const noshows = require('../api/noshows');
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '../samples/sample_noshow_webhook.json'), 'utf8'));

// ---- mock Slack-style endpoint (never touches the real client URL) ----
let slack, posts, failNext, delayMs;
test.before(async () => {
  slack = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', async () => {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (failNext > 0) { failNext -= 1; res.statusCode = 500; return res.end('boom'); }
      posts.push(JSON.parse(b));
      res.end('ok');
    });
  });
  await new Promise((r) => slack.listen(0, r));
  process.env.SLACK_WEBHOOK_URL = `http://127.0.0.1:${slack.address().port}/hook`;
});
test.after(() => slack.close());
test.beforeEach(() => { setStore(createMemoryStore()); posts = []; failNext = 0; delayMs = 0; });

function call(handler, { method = 'POST', headers = {}, body, query } = {}) {
  return new Promise(async (resolve) => {
    const res = {
      statusCode: 200, headers: {}, body: null,
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; resolve(this); return this; },
    };
    await handler({ method, headers, body, query }, res);
  });
}
const withSecret = { 'x-webhook-secret': SECRET };
const clone = (o) => JSON.parse(JSON.stringify(o));

test('rejects a request with no secret header', async () => {
  const r = await call(webhook, { body: sample });
  assert.strictEqual(r.statusCode, 401);
  assert.strictEqual(posts.length, 0);
  assert.strictEqual((await require('../lib/store').getStore().all()).length, 0);
});

test('rejects a wrong secret (and ignores the "secret" field in the body)', async () => {
  const r = await call(webhook, { headers: { 'x-webhook-secret': 'nope' }, body: sample });
  assert.strictEqual(r.statusCode, 401);
  assert.strictEqual(posts.length, 0);
});

test('valid no-show: stores it and posts closer, contact, time and rebook link to Slack', async () => {
  const r = await call(webhook, { headers: withSecret, body: sample });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.notified, true);
  assert.strictEqual(posts.length, 1);
  const t = posts[0].text;
  assert.match(t, /George Toro/);
  assert.match(t, /Mike Alvarez/);
  assert.match(t, /\+15125550142/);
  assert.match(t, /mike@alvarezpools\.example/);
  assert.match(t, /Wed, Nov 4, 7:00 PM ET/);
  assert.match(t, /https:\/\/example\.com\/book\/demo\?contact=ct_55aa91/);
  assert.strictEqual((await require('../lib/store').getStore().all()).length, 1);
});

test('duplicate delivery of the same event is ignored: one record, one Slack post', async () => {
  await call(webhook, { headers: withSecret, body: sample });
  const r2 = await call(webhook, { headers: withSecret, body: clone(sample) });
  assert.strictEqual(r2.statusCode, 200);
  assert.strictEqual(r2.body.duplicate, true);
  assert.strictEqual(posts.length, 1);
  assert.strictEqual((await require('../lib/store').getStore().all()).length, 1);
});

test('5 simultaneous duplicate deliveries still produce exactly one Slack post', async () => {
  delayMs = 120; // keep the first post in flight while the others arrive
  const results = await Promise.all(
    Array.from({ length: 5 }, () => call(webhook, { headers: withSecret, body: clone(sample) }))
  );
  assert.ok(results.every((r) => r.statusCode === 200));
  assert.strictEqual(posts.length, 1);
  assert.strictEqual((await require('../lib/store').getStore().all()).length, 1);
});

test('a no-show on a rebooked slot (new startTime) is a new event', async () => {
  await call(webhook, { headers: withSecret, body: sample });
  const again = clone(sample);
  again.appointment.startTime = '2026-11-06T15:00:00-05:00';
  await call(webhook, { headers: withSecret, body: again });
  assert.strictEqual(posts.length, 2);
});

test('non-noshow updates are acknowledged but not stored or posted', async () => {
  const b = clone(sample);
  b.appointment.appointmentStatus = 'confirmed';
  const r = await call(webhook, { headers: withSecret, body: b });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.ignored, true);
  assert.strictEqual(posts.length, 0);
});

test('malformed payload returns 400', async () => {
  const r = await call(webhook, { headers: withSecret, body: { hello: 'world' } });
  assert.strictEqual(r.statusCode, 400);
});

test('wrong method returns 405', async () => {
  const r = await call(webhook, { method: 'GET', headers: withSecret });
  assert.strictEqual(r.statusCode, 405);
});

test('Slack failure returns 502, and the sender retry completes the notification once', async () => {
  failNext = 1;
  const r1 = await call(webhook, { headers: withSecret, body: sample });
  assert.strictEqual(r1.statusCode, 502);
  assert.strictEqual(posts.length, 0);
  assert.strictEqual((await require('../lib/store').getStore().all()).length, 1); // event was kept
  const r2 = await call(webhook, { headers: withSecret, body: clone(sample) });
  assert.strictEqual(r2.statusCode, 200);
  assert.strictEqual(r2.body.notified, true);
  assert.strictEqual(posts.length, 1);
  const r3 = await call(webhook, { headers: withSecret, body: clone(sample) });
  assert.strictEqual(r3.body.duplicate, true);
  assert.strictEqual(posts.length, 1);
});

test('weekly view counts this week per closer, excludes other weeks, exposes no contact data', async () => {
  const now = Date.now();
  const mk = (id, closer, ts) => {
    const b = clone(sample);
    b.appointment.id = id;
    b.appointment.assignedUserId = 'u_' + closer;
    b.appointment.assignedUserName = closer;
    b.appointment.startTime = new Date(ts).toISOString();
    return b;
  };
  await call(webhook, { headers: withSecret, body: mk('a1', 'George Toro', now) });
  await call(webhook, { headers: withSecret, body: mk('a2', 'George Toro', now - 1000) });
  await call(webhook, { headers: withSecret, body: mk('a3', 'Yahya', now) });
  await call(webhook, { headers: withSecret, body: mk('old', 'Yahya', now - 14 * 86400000) });

  const r = await call(noshows, { method: 'GET' });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.total, 3);
  assert.strictEqual(r.body.isCurrentWeek, true);
  assert.strictEqual(r.body.followUpsSent, 3);
  assert.deepStrictEqual(
    r.body.closers.map((c) => [c.closer, c.noShows, c.followUpsSent]),
    [['George Toro', 2, 2], ['Yahya', 1, 1]]
  );
  assert.strictEqual(r.body.days.length, 7);
  assert.strictEqual(r.body.days.reduce((s, d) => s + d.count, 0), 3);
  assert.strictEqual(r.body.recent.length, 3);
  const json = JSON.stringify(r.body);
  for (const pii of ['alvarezpools', 'Alvarez', '5550142']) assert.ok(!json.includes(pii), `leaked ${pii}`);
});

test('weekly view: ?week= picks a past week (ET days, Mon-Sun) and compares with the week before', async () => {
  const mk = (id, startTime) => {
    const b = clone(sample);
    b.appointment.id = id;
    b.appointment.startTime = startTime;
    return b;
  };
  await call(webhook, { headers: withSecret, body: mk('w1', '2026-11-02T20:30:00-05:00') }); // Mon 8:30 PM ET (Tue in UTC)
  await call(webhook, { headers: withSecret, body: mk('w2', '2026-11-08T21:00:00-05:00') }); // Sun 9 PM ET (Mon in UTC)
  await call(webhook, { headers: withSecret, body: mk('p1', '2026-10-28T10:00:00-04:00') }); // week before

  const r = await call(noshows, { method: 'GET', query: { week: '2026-11-05' } });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.weekStart, '2026-11-02');
  assert.strictEqual(r.body.weekEnd, '2026-11-08');
  assert.strictEqual(r.body.total, 2);
  assert.strictEqual(r.body.prevTotal, 1);
  assert.deepStrictEqual(r.body.days.map((d) => d.count), [1, 0, 0, 0, 0, 0, 1]);
});

test('weekly view rejects a malformed ?week=', async () => {
  const r = await call(noshows, { method: 'GET', query: { week: 'yesterday' } });
  assert.strictEqual(r.statusCode, 400);
});
