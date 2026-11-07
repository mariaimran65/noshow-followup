// All "business day" logic is US Eastern (America/New_York). Intl handles DST,
// so nothing here hard-codes a UTC offset.
const TZ = 'America/New_York';

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

const labelFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit',
});

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
});

// ISO timestamp -> 'YYYY-MM-DD' in Eastern time
function etDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return dateFmt.format(d);
}

// ISO timestamp -> 'Wed, Nov 4, 7:00 PM ET'
function formatET(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${labelFmt.format(d)} ET`;
}

// Monday..Sunday (inclusive) of the Eastern-time week containing `now`.
function weekRangeET(now = new Date()) {
  const p = Object.fromEntries(
    partsFmt.formatToParts(now).map((x) => [x.type, x.value])
  );
  const idx = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[p.weekday];
  const base = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const day = 24 * 60 * 60 * 1000;
  return { start: iso(base - idx * day), end: iso(base + (6 - idx) * day) };
}

module.exports = { TZ, etDate, formatET, weekRangeET };
