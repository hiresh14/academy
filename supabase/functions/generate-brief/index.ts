// AIcademy live Brief generator (Supabase Edge Function, Deno).
// Runs on a schedule. Uses an LLM with web search to write a few current,
// plain-English AI-news items in AIcademy's voice and saves them to the
// public.brief table. The app reads the newest row.
// Deploy: supabase functions deploy generate-brief
// Secrets needed: OPENAI_API_KEY  (optional: BRIEF_MODEL, default gpt-4o)
import { createClient } from "npm:@supabase/supabase-js@2";

const VOICE = `You write AIcademy's Daily Brief. AIcademy is a learn-AI-by-doing app with 14 tracks
(Foundations, Prompting, Automations and Agents, Everyday AI, Websites, Marketing, Data, Build AI Products,
Leading AI, The Frontier, Make Money, Sales, GEO and SEO, AI Career).
Voice rules, follow exactly:
- Plain, warm, second person. No em dashes or en dashes anywhere. No hype words (delve, leverage, seamless, supercharge, game-changer).
- Each item connects the news to a durable skill the learner has, and stays calm and practical.
Find the 5 most important AI news items from the LAST 3 DAYS (use web search, prefer reputable sources).
Return ONLY a JSON array of 5 objects, no prose, in EXACTLY this shape:
[{"date":"YYYY-MM-DD","headline":"...","tldr":"one or two sentences","tags":["Tag","Tag"],
"source":{"name":"Publisher","url":"https://..."},
"article":{"what_happened":"2-3 sentences","why_it_matters":"2-3 sentences tying to a track","how_to_use":"2-3 sentences, a concrete next step","our_take":"2-3 sentences, a calm contrarian read"}}]`;

Deno.serve(async () => {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return new Response(JSON.stringify({ ok: false, error: "OPENAI_API_KEY not set" }), { status: 200, headers: { "content-type": "application/json" } });
  const model = Deno.env.get("BRIEF_MODEL") || "gpt-4o";

  // Ask an LLM (with web search) for current items as strict JSON.
  let text = "";
  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model, tools: [{ type: "web_search" }], input: VOICE }),
    });
    const j = await r.json();
    text = j.output_text || (j.output || []).map((o: any) => (o.content || []).map((c: any) => c.text || "").join("")).join("") || "";
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: "llm call failed: " + e.message }), { status: 200, headers: { "content-type": "application/json" } });
  }

  // Extract the JSON array.
  const start = text.indexOf("["), end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return new Response(JSON.stringify({ ok: false, error: "no JSON array in output" }), { status: 200, headers: { "content-type": "application/json" } });
  let items: any[];
  try { items = JSON.parse(text.slice(start, end + 1)); } catch { return new Response(JSON.stringify({ ok: false, error: "JSON parse failed" }), { status: 200, headers: { "content-type": "application/json" } }); }

  // Light validation + dash sweep so the app's voice rules hold even if the model slips.
  const clean = (s: any) => String(s == null ? "" : s).replace(/[—–]/g, " ");
  items = (items || []).filter(it => it && it.headline && it.article).slice(0, 6).map(it => ({
    date: clean(it.date) || new Date().toISOString().slice(0, 10),
    headline: clean(it.headline), tldr: clean(it.tldr),
    tags: Array.isArray(it.tags) ? it.tags.slice(0, 3).map(clean) : [],
    source: it.source && it.source.url ? { name: clean(it.source.name), url: String(it.source.url) } : null,
    article: {
      what_happened: clean(it.article.what_happened), why_it_matters: clean(it.article.why_it_matters),
      how_to_use: clean(it.article.how_to_use), our_take: clean(it.article.our_take),
    },
  }));
  if (!items.length) return new Response(JSON.stringify({ ok: false, error: "no valid items" }), { status: 200, headers: { "content-type": "application/json" } });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await supabase.from("brief").insert({ items });
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 200, headers: { "content-type": "application/json" } });

  // Keep only the latest ~20 rows.
  return new Response(JSON.stringify({ ok: true, inserted: items.length }), { status: 200, headers: { "content-type": "application/json" } });
});
