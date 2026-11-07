const { getStore } = require('../lib/store');
const { etDate, formatET, weekRangeET, TZ } = require('../lib/time');

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const RECENT_LIMIT = 8;

// 'YYYY-MM-DD' -> a Date at noon UTC that day (always the same calendar day in Eastern time).
function noonUTC(ymd) {
  return new Date(`${ymd}T12:00:00Z`);
}

function addDays(ymd, n) {
  return new Date(noonUTC(ymd).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

// Weekly no-shows (Mon-Sun, US Eastern) for the dashboard.
// GET /api/noshows            -> the current week
// GET /api/noshows?week=DATE  -> the week containing DATE (YYYY-MM-DD)
// Counts and closer names only: this page is public, so no contact details are exposed.
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const query = req.query || (req.url ? Object.fromEntries(new URL(req.url, 'http://x').searchParams) : {});
  const weekParam = query.week;
  if (weekParam !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(weekParam) || Number.isNaN(noonUTC(weekParam).getTime()))) {
    return res.status(400).json({ error: 'week must be a date in YYYY-MM-DD format' });
  }

  try {
    const today = etDate(new Date().toISOString());
    const current = weekRangeET(new Date());
    const { start, end } = weekParam ? weekRangeET(noonUTC(weekParam)) : current;
    const prev = { start: addDays(start, -7), end: addDays(start, -1) };
    const days = WEEKDAYS.map((label, i) => ({ date: addDays(start, i), label, count: 0 }));

    const events = await getStore().all();
    const byCloser = new Map();
    const inWeek = [];
    let prevTotal = 0;

    for (const e of events) {
      const day = etDate(e.startTime);
      if (!day) continue;
      if (day >= prev.start && day <= prev.end) prevTotal += 1;
      if (day < start || day > end) continue; // YYYY-MM-DD compares correctly as strings

      const idx = Math.round((noonUTC(day) - noonUTC(start)) / DAY_MS);
      days[idx].count += 1;
      inWeek.push(e);

      const name = e.closerName || 'Unassigned closer';
      const c = byCloser.get(name) || { closer: name, noShows: 0, followUpsSent: 0, byDay: [0, 0, 0, 0, 0, 0, 0] };
      c.noShows += 1;
      if (e.slackPosted) c.followUpsSent += 1;
      c.byDay[idx] += 1;
      byCloser.set(name, c);
    }

    const closers = [...byCloser.values()]
      .sort((a, b) => b.noShows - a.noShows || a.closer.localeCompare(b.closer));

    const recent = inWeek
      .sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))
      .slice(0, RECENT_LIMIT)
      .map((e) => ({
        closer: e.closerName || 'Unassigned closer',
        appointment: formatET(e.startTime),
        receivedAt: e.receivedAt,
        followUpSent: Boolean(e.slackPosted),
      }));

    const lastReceivedAt = events.reduce(
      (max, e) => (e.receivedAt && (!max || e.receivedAt > max) ? e.receivedAt : max), null
    );

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      weekStart: start,
      weekEnd: end,
      timezone: TZ,
      today,
      isCurrentWeek: start === current.start,
      total: inWeek.length,
      prevTotal,
      followUpsSent: inWeek.filter((e) => e.slackPosted).length,
      days,
      closers,
      recent,
      lastReceivedAt,
    });
  } catch (err) {
    console.error('noshows_error', err.message);
    return res.status(500).json({ error: 'Could not load no-shows' });
  }
};
