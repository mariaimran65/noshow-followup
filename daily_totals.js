// daily_totals.js: counts held demos per day for the sales dashboard.
// The sales team works in US Eastern time. Demos run 9 AM to 9 PM ET.
//
// FIX 1 (root cause): days were bucketed by the UTC date (toISOString().slice(0,10)).
//   Any demo starting after 7 PM ET is already "tomorrow" in UTC, so it landed on the
//   wrong day. Now we bucket by the America/New_York calendar date. Intl handles DST,
//   so there is no hard-coded -05:00 offset that would break after the clocks change.
// FIX 2: the feed can contain duplicate webhook deliveries (d2 appears twice). Rows are
//   now deduplicated by id so a re-delivery cannot inflate a day.
//
// Run: node daily_totals.js

const TZ = 'America/New_York';
const etDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

const demos = [
  { id: 'd1', closer: 'George', status: 'showed', startTime: '2026-11-02T14:00:00Z' }, // Mon 9:00 AM ET
  { id: 'd2', closer: 'Yahya',  status: 'showed', startTime: '2026-11-02T18:30:00Z' }, // Mon 1:30 PM ET
  { id: 'd3', closer: 'George', status: 'showed', startTime: '2026-11-03T00:30:00Z' }, // Mon 7:30 PM ET
  { id: 'd4', closer: 'Yahya',  status: 'noshow', startTime: '2026-11-03T01:00:00Z' }, // Mon 8:00 PM ET
  { id: 'd5', closer: 'George', status: 'showed', startTime: '2026-11-03T15:00:00Z' }, // Tue 10:00 AM ET
  { id: 'd6', closer: 'Yahya',  status: 'showed', startTime: '2026-11-04T01:45:00Z' }, // Tue 8:45 PM ET
  { id: 'd7', closer: 'George', status: 'showed', startTime: '2026-11-04T16:00:00Z' }, // Wed 11:00 AM ET
  { id: 'd2', closer: 'Yahya',  status: 'showed', startTime: '2026-11-02T18:30:00Z' }, // duplicate webhook delivery of d2
];

function dailyTotals(rows) {
  const totals = {};
  const seen = new Set();
  for (const r of rows) {
    if (r.status !== 'showed') continue;
    if (seen.has(r.id)) continue; // duplicate delivery
    seen.add(r.id);
    const day = etDay.format(new Date(r.startTime)); // 'YYYY-MM-DD' in Eastern time
    totals[day] = (totals[day] || 0) + 1;
  }
  return totals;
}

module.exports = { dailyTotals };

if (require.main === module) console.log(dailyTotals(demos));
