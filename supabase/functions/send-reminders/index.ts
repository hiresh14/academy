// AIcademy behavioral notification engine (Supabase Edge Function, Deno).
// Run hourly. For each subscriber it picks the right nudge based on what they did,
// and sends at most once per day, only within a sensible hour window.
// Deploy: supabase functions deploy send-reminders
// Secrets: VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const APP_URL = "https://academy-iota-six.vercel.app/";

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") || "mailto:levelupedtech@gmail.com",
    Deno.env.get("VAPID_PUBLIC")!,
    Deno.env.get("VAPID_PRIVATE")!
  );

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const hourUTC = now.getUTCHours();
  // Only send in a friendly window: ~9:30am to 9:30pm IST (04:00–16:00 UTC).
  if (hourUTC < 4 || hourUTC > 16) {
    return new Response(JSON.stringify({ skipped: "outside send window" }), { headers: { "content-type": "application/json" } });
  }

  const { data: subs } = await supabase.from("push_subscriptions").select("user_id, endpoint, subscription, last_notified");
  const { data: progs } = await supabase.from("progress").select("user_id, state");
  const stateByUser: Record<string, any> = {};
  (progs || []).forEach((p: any) => { stateByUser[p.user_id] = p.state || {}; });

  let sent = 0, cleaned = 0;
  for (const row of (subs || [])) {
    if (row.last_notified === today) continue;            // already nudged today
    const st = stateByUser[row.user_id] || {};
    if (st.lastActive === today) continue;                // already studied today, leave them alone

    const streak = st.streak || 0;
    const started = st.lessons && Object.keys(st.lessons).length > 0;
    const daysSince = st.lastActive ? daysBetween(st.lastActive, today) : 999;

    let title: string, body: string;
    if (streak > 0 && daysSince <= 1) {
      title = `Your ${streak} day streak is on the line 🔥`;
      body = "Finish one quick lesson to keep it alive.";
    } else if (started && daysSince <= 2) {
      title = "Come back and finish your lesson 📘";
      body = "You started strong. A couple of minutes keeps you moving, don't get left behind.";
    } else if (daysSince <= 7) {
      title = "Your AI path is waiting 👋";
      body = "Pick up where you left off, it only takes a few minutes today.";
    } else {
      title = "Ready to get back into AI? 🚀";
      body = "Two minutes today restarts your momentum. Your next lesson is one tap away.";
    }

    try {
      await webpush.sendNotification(row.subscription, JSON.stringify({ title, body, url: APP_URL }));
      await supabase.from("push_subscriptions").update({ last_notified: today }).eq("endpoint", row.endpoint);
      sent++;
    } catch (e: any) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", row.endpoint);
        cleaned++;
      }
    }
  }
  return new Response(JSON.stringify({ sent, cleaned }), { headers: { "content-type": "application/json" } });
});
