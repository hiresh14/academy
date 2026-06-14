# Live Brief pipeline — setup

The Brief tab shows current AI news and refreshes itself. How it works:
- The app reads the newest row from the Supabase `brief` table. If the table is empty or unreachable, it falls back to the on-brand items hard-coded in the app, so the Brief is never blank.
- A scheduled Edge Function `generate-brief` uses an LLM with web search to write a few fresh, plain-English, on-voice items every few hours and inserts a new row.

## Already done
- `brief` table created with public read access (anon can select; only the service role writes).
- The app (`index.html`) reads live items via `loadBrief()` and falls back to the built-in `NEWS` list.
- The generator function is written at `supabase/functions/generate-brief/index.ts`.

## To switch on auto-refresh (needs the OpenAI key)
1. Set the key as a function secret (this is the parked item for Rahul: rotate, then set):
```bash
cd "Claude Cowork/Forge AI Residency/aicademy"
npx supabase functions deploy generate-brief --no-verify-jwt
npx supabase secrets set OPENAI_API_KEY=sk-...        # optional: BRIEF_MODEL=gpt-4o
```
2. Schedule it (Supabase SQL editor). Every 6 hours, inside the day:
```sql
select cron.schedule(
  'aicademy-brief',
  '0 */6 * * *',
  $$ select net.http_post(
       url := 'https://hhsucudtvnndsfeibaxk.supabase.co/functions/v1/generate-brief',
       headers := jsonb_build_object('Authorization','Bearer YOUR_SERVICE_ROLE_KEY','Content-Type','application/json')
     ); $$
);
```
3. Test once from the terminal:
```bash
curl -X POST 'https://hhsucudtvnndsfeibaxk.supabase.co/functions/v1/generate-brief' \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"
```
The function self-protects: if the key is missing or the model output is malformed, it inserts nothing and the app keeps showing the last good Brief.

## Cadence
Default is every 6 hours. To go faster, change the cron (e.g. `0 */2 * * *` for every 2 hours). True minute-by-minute "Twitter speed" is not cost-effective; a few times a day reads as current to a learner.

## Voice guardrail
The generator is told AIcademy's voice rules (plain, second person, no em dashes, no hype words, tie each item to a track) and the function also strips any em or en dashes from the model output before saving, so the Brief stays on-brand even if the model slips.
