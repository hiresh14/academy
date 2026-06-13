# AIcademy admin dashboard — setup

The dashboard reads your real usage data (signups, device, minutes, onboarding answers, funnel, drop-off). It runs on the data the app already syncs to the `progress` table, so there is no new table to create. Two pieces:

1. A token-protected Edge Function `admin-stats` that reads all rows with the service role (the powerful key stays on the server).
2. `admin.html`, a private page you open in your browser.

## 1. Pick an admin token
Generate a long random string (this is your dashboard password). For example, in a terminal:
```
openssl rand -hex 24
```
Keep it private. Never put it in the app or commit it.

## 2. Deploy the function (terminal, your own Supabase login)
```bash
cd "Claude Cowork/Forge AI Residency/aicademy"
npx supabase functions deploy admin-stats --no-verify-jwt
npx supabase secrets set ADMIN_TOKEN=PASTE_YOUR_TOKEN
```
`--no-verify-jwt` makes the function reachable from the browser; the ADMIN_TOKEN is what actually gates it. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the function automatically.

(You can also create the function from the Supabase dashboard: Edge Functions, New function, paste `supabase/functions/admin-stats/index.ts`, then add the ADMIN_TOKEN secret under the function's settings, and turn off "Verify JWT".)

## 3. Open the dashboard
Open `admin.html` (locally, or host it privately). On first load it asks for:
- Project URL: `https://hhsucudtvnndsfeibaxk.supabase.co`
- anon public key (the same public key the app uses, safe to paste)
- admin token (from step 1)

These are stored only in your browser. Hit Refresh anytime for live numbers.

## What it shows
- Totals: users, active in last 7 days, new in last 7 days, completed onboarding, average minutes per user, total minutes.
- Signups by day, device split (mobile vs desktop), active minutes by day, and time-of-day usage (which hours people learn).
- Funnel: how many people reached vs completed each of the 14 tracks.
- Drop-off: which track people get furthest into, and where inactive (3+ day) users stopped. That "where" is the signal for what to improve.
- Onboarding breakdowns: role, experience level, goal, chosen rhythm, what they are applying it to.
- A users table: email, answers, device, minutes, lessons done, tracks completed, furthest point, XP, streak, last seen.

## Note on "why" people drop off
No tool can read intent. The dashboard pins down the where and when precisely (e.g. "most mobile users stop at Agents lesson 3 after ~4 min"), which is what tells you the why. If you later want session replay to literally watch sessions, a free tool like PostHog can be added with one script tag.
