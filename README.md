# No-show follow-up (BuilderBot Pro trial)

When a homeowner no-shows, a webhook hits this endpoint. It verifies the sender, ignores
duplicate deliveries, stores the event, and posts to Slack with a rebook link. A one-page view
shows no-shows per closer for the current week.

```
api/webhook.js    POST  receives the webhook
api/noshows.js    GET   weekly no-shows per closer (?week=YYYY-MM-DD for past weeks)
public/index.html       the one-page dashboard
lib/              time (US Eastern), storage (Redis REST / in-memory), Slack message
daily_totals.js         bug-hunt fix
test/                   16 tests (node --test)
```

## How the webhook behaves

| Situation | Result |
|---|---|
| Missing / wrong `X-Webhook-Secret` | `401`, nothing stored, no Slack post (checked first, constant-time compare) |
| Malformed payload | `400` |
| Status other than `noshow` | `200 {ignored:true}`, not stored |
| New no-show | stored, Slack posted, `200` |
| Duplicate delivery (same appointment + status + startTime) | `200 {duplicate:true}`, no second Slack post |
| Slack is down | event is kept, `502` so the sender retries, and the retry finishes the post once |

Dedupe is one atomic Redis `HSETNX`, plus a short in-flight lease, so even simultaneous
duplicates produce exactly one Slack message (covered by a test with 5 parallel deliveries).
A no-show on a rebooked slot has a new `startTime`, so it counts as a new event.

## Run locally

```bash
cp .env.example .env            # or just export the vars
WEBHOOK_SECRET=trial-secret-7f3a npm run dev     # http://localhost:3000 (in-memory storage)
npm test
```

```bash
curl -i -X POST http://localhost:3000/api/webhook \
  -H 'X-Webhook-Secret: trial-secret-7f3a' -H 'Content-Type: application/json' \
  -d @samples/sample_noshow_webhook.json
```

## Deploy (Vercel)

1. Push to GitHub, then Vercel -> Add New -> Project -> import the repo (Framework: Other) -> Deploy.
2. Project -> Storage -> add Upstash Redis and connect it to this project.
3. Project -> Settings -> Environment Variables: `WEBHOOK_SECRET=trial-secret-7f3a`.
4. Redeploy (env vars only apply to new deployments).

On Vercel the app refuses to run without a Redis store, because in-memory storage would silently
lose data between serverless invocations.

## Bug hunt: `daily_totals.js`

`dailyTotals` buckets every demo with `new Date(startTime).toISOString().slice(0, 10)`, which is the UTC calendar date, but the sales team works in US Eastern time, so any demo starting after 7 PM ET (d3 at Mon 7:30 PM, d6 at Tue 8:45 PM) is already "tomorrow" in UTC and is counted a day late, which shifts demos between neighbouring days and leaves the weekly total looking right. The fix buckets by the `America/New_York` date using `Intl.DateTimeFormat`, which also stays correct across daylight-saving changes, unlike hard-coding a -5 hour offset. A second problem hid behind it: the feed contains a duplicate delivery of d2, which cancelled out the missing d3 on Monday by coincidence and inflated the week to 7, so I also dedupe by `id`, and the corrected totals are Nov 2: 3, Nov 3: 2, Nov 4: 1 (was 3, 2, 2).

## Deliberately left out / next

- The weekly page is public, so it shows counts only, no contact details. Add auth before showing more.
- Takeover after a Slack failure is not an atomic compare-and-set; two retries landing in the same millisecond could double-post. Fine at this volume, fix with a Lua script or a queue at scale.
- No alerting yet when Slack fails repeatedly.

## Security Check command:
curl -i -X POST https://noshow-followup.vercel.app/api/webhook -H 'Content-Type: application/json' -d @samples/sample_noshow_webhook.json

## New No-Show commmand: 
sed -e 's/apt_9Kq2LmX81/apt_demo_002/' -e 's/usr_closer_george/usr_closer_yahya/' -e 's/George Toro/Yahya/' -e 's/2026-11-04T19:00/2026-11-06T18:00/' samples/sample_noshow_webhook.json | curl -i -X POST https://noshow-followup.vercel.app/api/webhook -H 'X-Webhook-Secret: trial-secret-7f3a' -H 'Content-Type: application/json' -d @-



## The dashboard

One page, no build step, no dependencies:

- **Summary:** no-shows this week vs last week, how many Slack follow-ups went out, how many closers had a no-show, and the busiest day.
- **No-shows by day:** Mon–Sun in US Eastern time, with hover tooltips.
- **By closer:** ranked, with a 7-day strip and follow-up status for each closer.
- **Recent no-shows:** shows "Slack sent" or "Retrying" for each event; new events are highlighted when they arrive.
- **Week navigation:** browse past weeks, and share a week as a link (`?week=`).
- **Live:** refreshes every 15 seconds while the tab is open; works on phones and in dark mode.
