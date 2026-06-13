# AIcademy push notifications — go-live steps

Everything is built. The app already registers the service worker and shows a "Turn on daily reminders" card. These steps switch on storage + the daily sender. About 5 minutes, all copy-paste. Your VAPID keys are in `PUSH_SECRETS.local.txt` (git-ignored, never committed).

## 1. Create the subscriptions table (Supabase SQL editor)

```sql
create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade,
  endpoint text unique,
  subscription jsonb not null,
  created_at timestamptz default now()
);
alter table public.push_subscriptions enable row level security;
create policy "own insert" on public.push_subscriptions for insert with check (auth.uid() = user_id);
create policy "own select" on public.push_subscriptions for select using (auth.uid() = user_id);
create policy "own delete" on public.push_subscriptions for delete using (auth.uid() = user_id);
```

## 2. Deploy the sender function (terminal, uses your own Supabase login)

```bash
cd "Claude Cowork/Forge AI Residency/aicademy"
npx supabase login            # opens your browser, no secret typed in chat
npx supabase link --project-ref hhsucudtvnndsfeibaxk
npx supabase functions deploy send-reminders
```

Then set the three secrets (copy the values from `PUSH_SECRETS.local.txt`):

```bash
npx supabase secrets set \
  VAPID_PUBLIC=PASTE_PUBLIC \
  VAPID_PRIVATE=PASTE_PRIVATE \
  VAPID_SUBJECT=mailto:levelupedtech@gmail.com
```

(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the function automatically — you do not set those.)

## 3. Schedule it daily (Supabase SQL editor)

Enable the `pg_cron` and `pg_net` extensions (Database → Extensions), then run (paste your project's service role key where shown):

```sql
select cron.schedule(
  'aicademy-daily-reminders',
  '0 13 * * *',  -- 13:00 UTC ≈ 6:30pm IST, adjust as you like
  $$ select net.http_post(
       url := 'https://hhsucudtvnndsfeibaxk.supabase.co/functions/v1/send-reminders',
       headers := jsonb_build_object('Authorization','Bearer YOUR_SERVICE_ROLE_KEY','Content-Type','application/json')
     ); $$
);
```

## Done

Now: a learner signs in, taps "Turn on daily reminders", and every day at the scheduled time anyone who has not studied that day gets a "Keep your streak alive 🔥" push. On iPhone they must add AIcademy to the home screen first (Apple's rule) — the install is already enabled.

To test immediately without waiting for the cron, hit the function once from the terminal:
```bash
curl -X POST 'https://hhsucudtvnndsfeibaxk.supabase.co/functions/v1/send-reminders' \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"
```
