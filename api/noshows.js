const { getStore } = require('../lib/store');
const { etDate, weekRangeET, TZ } = require('../lib/time');

// Returns this week's (Mon-Sun, Eastern) no-shows grouped by closer.
// Counts only: this page is public, so no contact details are exposed.
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { start, end } = weekRangeET(new Date());
    const events = await getStore().all();

    const byCloser = new Map();
    let total = 0;
    for (const e of events) {
      const day = etDate(e.startTime);
      if (!day || day < start || day > end) continue; // YYYY-MM-DD compares correctly as strings
      total += 1;
      byCloser.set(e.closerName, (byCloser.get(e.closerName) || 0) + 1);
    }
    const closers = [...byCloser.entries()]
      .map(([closer, noShows]) => ({ closer, noShows }))
      .sort((a, b) => b.noShows - a.noShows || a.closer.localeCompare(b.closer));

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ weekStart: start, weekEnd: end, timezone: TZ, total, closers });
  } catch (err) {
    console.error('noshows_error', err.message);
    return res.status(500).json({ error: 'Could not load no-shows' });
  }
};
