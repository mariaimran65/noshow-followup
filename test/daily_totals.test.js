const test = require('node:test');
const assert = require('node:assert');
const { dailyTotals } = require('../daily_totals');

test('buckets late-evening demos on the Eastern day, not the UTC day', () => {
  const rows = [
    { id: 'a', status: 'showed', startTime: '2026-11-03T00:30:00Z' }, // Mon 7:30 PM ET
    { id: 'b', status: 'showed', startTime: '2026-11-04T01:45:00Z' }, // Tue 8:45 PM ET
  ];
  assert.deepStrictEqual(dailyTotals(rows), { '2026-11-02': 1, '2026-11-03': 1 });
});

test('ignores duplicate deliveries of the same demo id', () => {
  const row = { id: 'x', status: 'showed', startTime: '2026-11-02T18:30:00Z' };
  assert.deepStrictEqual(dailyTotals([row, row]), { '2026-11-02': 1 });
});

test('skips no-shows', () => {
  assert.deepStrictEqual(dailyTotals([{ id: 'n', status: 'noshow', startTime: '2026-11-02T18:30:00Z' }]), {});
});

test('stays correct across the DST change (EDT, UTC-4, before Nov 1 2026)', () => {
  // Fri Oct 30 2026 8:30 PM EDT = Sat Oct 31 00:30Z
  assert.deepStrictEqual(
    dailyTotals([{ id: 'e', status: 'showed', startTime: '2026-10-31T00:30:00Z' }]),
    { '2026-10-30': 1 }
  );
});

test('the full sample from the brief gives the real Eastern-time counts', () => {
  const rows = [
    { id: 'd1', status: 'showed', startTime: '2026-11-02T14:00:00Z' },
    { id: 'd2', status: 'showed', startTime: '2026-11-02T18:30:00Z' },
    { id: 'd3', status: 'showed', startTime: '2026-11-03T00:30:00Z' },
    { id: 'd4', status: 'noshow', startTime: '2026-11-03T01:00:00Z' },
    { id: 'd5', status: 'showed', startTime: '2026-11-03T15:00:00Z' },
    { id: 'd6', status: 'showed', startTime: '2026-11-04T01:45:00Z' },
    { id: 'd7', status: 'showed', startTime: '2026-11-04T16:00:00Z' },
    { id: 'd2', status: 'showed', startTime: '2026-11-02T18:30:00Z' },
  ];
  assert.deepStrictEqual(dailyTotals(rows), { '2026-11-02': 3, '2026-11-03': 2, '2026-11-04': 1 });
});
