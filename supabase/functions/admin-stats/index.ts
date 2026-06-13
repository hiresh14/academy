// AIcademy admin analytics (Supabase Edge Function, Deno).
// Reads ALL progress rows with the service role and returns aggregated stats.
// Gated by a shared ADMIN_TOKEN secret. The service key never leaves the server.
// Deploy: supabase functions deploy admin-stats
// Secret:  ADMIN_TOKEN (a long random string you keep private)
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-admin-token, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

function sumVals(o: Record<string, number> | undefined): number {
  if (!o) return 0; let t = 0; for (const k in o) t += Number(o[k]) || 0; return t;
}
function mergeInto(target: Record<string, number>, src: Record<string, number> | undefined){
  if (!src) return; for (const k in src) target[k] = (target[k] || 0) + (Number(src[k]) || 0);
}
function bump(o: Record<string, number>, key: string | undefined | null){
  const k = (key == null || key === "") ? "unknown" : String(key); o[k] = (o[k] || 0) + 1;
}
function daysAgo(iso: string | null): number {
  if (!iso) return 99999; return (Date.now() - Date.parse(iso)) / 86400000;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const token = req.headers.get("x-admin-token") || url.searchParams.get("token") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const expected = Deno.env.get("ADMIN_TOKEN");
  if (!expected || token !== expected) return json({ ok: false, error: "unauthorized" }, 401);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: rows, error } = await supabase.from("progress").select("email, profile, state, updated_at");
  if (error) return json({ ok: false, error: error.message }, 500);

  const NMOD = 14;
  const totals = { users: 0, withEmail: 0, completedOnboarding: 0, newToday: 0, new7d: 0, activeToday: 0, active7d: 0 };
  const device: Record<string, number> = { mobile: 0, desktop: 0, unknown: 0 };
  const onboarding = {
    role: {} as Record<string, number>, level: {} as Record<string, number>,
    goal: {} as Record<string, number>, minutes: {} as Record<string, number>,
    spineType: {} as Record<string, number>,
  };
  const minutesByDay: Record<string, number> = {};
  const minutesByHour: Record<string, number> = {};
  const signupsByDay: Record<string, number> = {};
  const funnelReached = new Array(NMOD).fill(0);
  const funnelCompleted = new Array(NMOD).fill(0);
  const furthestHist: Record<string, number> = {};
  const stalledAt: Record<string, number> = {};   // "type m<idx> L<li>" -> count of stalled users
  let totalMinutes = 0;
  const users: any[] = [];

  for (const r of (rows || [])) {
    const st = r.state || {}, pf = r.profile || {};
    totals.users++;
    if (r.email) totals.withEmail++;
    if (pf.spine || pf.goal) totals.completedOnboarding++;

    const dev = st.device || pf.device || "unknown";
    device[dev] = (device[dev] || 0) + 1;

    bump(onboarding.role, pf.role); bump(onboarding.level, pf.level);
    bump(onboarding.goal, pf.goal); bump(onboarding.minutes, pf.minutes);
    bump(onboarding.spineType, pf.spineType);

    const firstSeen = st.firstSeen || pf.obAt || r.updated_at || null;
    const lastSeen = st.lastSeen || r.updated_at || null;
    if (firstSeen) { const d = String(firstSeen).slice(0, 10); signupsByDay[d] = (signupsByDay[d] || 0) + 1; }
    if (daysAgo(firstSeen) < 1) totals.newToday++;
    if (daysAgo(firstSeen) < 7) totals.new7d++;
    if (daysAgo(lastSeen) < 1) totals.activeToday++;
    if (daysAgo(lastSeen) < 7) totals.active7d++;

    mergeInto(minutesByDay, st.minutes);
    mergeInto(minutesByHour, st.minByHour);
    const mins = sumVals(st.minutes); totalMinutes += mins;

    const lessons = st.lessons || {}, assign = st.assignDone || {};
    let lessonsDone = 0; for (const k in lessons) if (lessons[k]) lessonsDone++;
    let modulesComplete = 0;
    for (let i = 0; i < NMOD; i++) {
      const id = "m" + (i + 1);
      let started = false; for (const k in lessons) { if (k.indexOf(id + "_") === 0 && lessons[k]) { started = true; break; } }
      const furthestMi = st.furthest ? st.furthest.mi : -1;
      if (started || furthestMi >= i) funnelReached[i]++;
      if (assign[id]) { funnelCompleted[i]++; modulesComplete++; }
    }

    const fmi = st.furthest ? st.furthest.mi : -1;
    bump(furthestHist, fmi < 0 ? "none" : "m" + (fmi + 1));
    // stalled: inactive 3+ days and has not finished the last track
    if (daysAgo(lastSeen) >= 3 && !assign["m" + NMOD]) {
      const ls = st.lastScreen;
      const label = ls ? (ls.t + " m" + ((ls.mi || 0) + 1) + (ls.li != null ? " L" + (ls.li + 1) : "")) : "before first lesson";
      stalledAt[label] = (stalledAt[label] || 0) + 1;
    }

    users.push({
      email: r.email || "(no email)", role: pf.role || "", level: pf.level || "", goal: pf.goal || "",
      minutes: pf.minutes || "", spineType: pf.spineType || "", spine: pf.spine || "", device: dev,
      firstSeen, lastSeen, minutesTotal: mins, lessonsDone, modulesComplete,
      furthest: st.furthest ? ("m" + ((st.furthest.mi || 0) + 1) + (st.furthest.li != null ? " L" + (st.furthest.li + 1) : "")) : "",
      xp: st.xp || 0, streak: st.streak || 0,
    });
  }

  users.sort((a, b) => String(b.lastSeen || "").localeCompare(String(a.lastSeen || "")));

  return json({
    ok: true,
    generatedAt: new Date().toISOString(),
    totals,
    engagement: { totalMinutes, avgMinutesPerUser: totals.users ? Math.round(totalMinutes / totals.users) : 0 },
    device, onboarding,
    minutesByDay, minutesByHour, signupsByDay,
    funnel: Array.from({ length: NMOD }, (_, i) => ({ i, module: "m" + (i + 1), reached: funnelReached[i], completed: funnelCompleted[i] })),
    dropoff: { furthest: furthestHist, stalledAt },
    users: users.slice(0, 1000),
  });
});
