// AIcademy daily reminder sender (Supabase Edge Function, Deno).
// Sends a push to anyone who has not studied today, nudging their streak.
// Deploy: supabase functions deploy send-reminders
// Secrets needed: VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

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

  const today = new Date().toISOString().slice(0, 10);
  const { data: subs } = await supabase.from("push_subscriptions").select("user_id, endpoint, subscription");
  const { data: progs } = await supabase.from("progress").select("user_id, state");
  const stateByUser: Record<string, any> = {};
  (progs || []).forEach((p: any) => { stateByUser[p.user_id] = p.state || {}; });

  let sent = 0, cleaned = 0;
  for (const row of (subs || [])) {
    const st = stateByUser[row.user_id] || {};
    if (st.lastActive === today) continue; // already studied today, leave them alone
    const streak = st.streak || 0;
    const title = streak > 0 ? `Keep your ${streak} day streak alive 🔥` : "Your AI lesson is waiting";
    const body = streak > 0 ? "A quick lesson keeps the streak going." : "Two minutes today moves you forward.";
    try {
      await webpush.sendNotification(
        row.subscription,
        JSON.stringify({ title, body, url: "https://academy-iota-six.vercel.app/" })
      );
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
