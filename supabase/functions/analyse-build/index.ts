// AIcademy Build Studio — reverse-engineer + adapt (Supabase Edge Function, Deno).
//
// DORMANT (not called by the app). The Studio uses the no-cost "handoff" model:
// the frontend composes a prompt and the user runs it in their OWN Claude/ChatGPT,
// so no server LLM call is billed. Kept here in case the in-app (LevelUp-funded)
// model is ever revisited; the already-deployed copy is harmless and idle.
//
// Takes something a founder saw (a tweet/LinkedIn/YouTube/Loom/website URL, or a
// free-text description) plus their business context ("Second Brain"), works out
// what the build actually is and how it's made, then rewrites the whole plan for
// THEIR business as a structured Build Card.
//
// Deploy:  supabase functions deploy analyse-build
// Secrets: ANTHROPIC_API_KEY   (optional: STUDIO_MODEL, default claude-sonnet-4-6)
//
// The frontend calls this with the project anon key. Returns { ok, card } | { ok:false, error }.

const MODEL = Deno.env.get("STUDIO_MODEL") || "claude-sonnet-4-6";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

const stripTags = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());
const ytId = (u: string) => {
  const m = u.match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/)([\w-]{11})/);
  return m ? m[1] : null;
};

// Best-effort: pull readable source text. Never throws — returns "" on any failure
// so the model can still work from the URL + its own knowledge.
async function fetchSource(url: string): Promise<{ text: string; note: string }> {
  try {
    const id = ytId(url);
    if (id) {
      // Try YouTube's public timedtext transcript.
      for (const lang of ["en", "en-US", "en-GB"]) {
        try {
          const r = await fetch(`https://www.youtube.com/api/timedtext?lang=${lang}&v=${id}`);
          const xml = await r.text();
          if (xml && xml.includes("<text")) {
            const t = stripTags(xml).slice(0, 12000);
            if (t.length > 40) return { text: t, note: "youtube transcript" };
          }
        } catch { /* try next */ }
      }
      return { text: "", note: "youtube: no public transcript found" };
    }
    const r = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; AIcademyBot/1.0)" },
      redirect: "follow",
    });
    const html = await r.text();
    const text = stripTags(html).slice(0, 12000);
    return { text, note: text.length > 80 ? "page text" : "page returned little text" };
  } catch (e) {
    return { text: "", note: "fetch failed: " + ((e as Error).message || "unknown") };
  }
}

function buildPrompt(input: string, sourceText: string, sourceNote: string, ctx: Record<string, string>) {
  const codes = String(ctx.codes || "").toLowerCase() === "true" || /yes|code|engineer|dev/i.test(ctx.current_stack || "");
  const bc = [
    ctx.what_you_do && `What they do: ${ctx.what_you_do}`,
    ctx.target_customer && `Their customer: ${ctx.target_customer}`,
    ctx.current_stack && `Their current tools: ${ctx.current_stack}`,
    ctx.main_challenge && `Their main challenge: ${ctx.main_challenge}`,
    ctx.build_goal && `Their build goal: ${ctx.build_goal}`,
  ].filter(Boolean).join("\n");

  return `You help a non-technical founder turn an AI thing they saw into a build they can actually ship for THEIR business.

THE FOUNDER'S BUSINESS (their Second Brain):
${bc || "(They have not filled this in yet. Keep the adaptation general but practical, and tell them in 'adapted_for' that filling in their business profile will make this sharper.)"}

WHAT THEY SAW:
${input ? `Their words: ${input}` : ""}
${sourceText ? `\nExtracted from the source (${sourceNote}):\n${sourceText}` : sourceNote ? `\n(Could not read the source automatically: ${sourceNote}. Work from their words and your own knowledge.)` : ""}

YOUR JOB:
1. Reverse-engineer it: what it does, the tools/stack behind it, and the real steps to build it.
2. Adapt it to THEIR business specifically, using their Second Brain above.
3. Default to a NO-CODE build (tools like n8n, Make, Lovable, Claude Projects, Zapier, Airtable, Google Sheets) ${codes ? "but they CAN code, so a light technical path is fine where it's genuinely simpler." : "because they do not code. Do not suggest writing code, repos, or terminals."}

VOICE: Plain, warm, second person. No em dashes or en dashes. No hype words (delve, leverage, seamless, supercharge, game-changer). Calm and concrete.

Return ONLY a JSON object, no prose, in EXACTLY this shape:
{
  "title": "short punchy name for the build, max 7 words",
  "what_it_does": "2-3 sentences, plain English, what this does for their business",
  "tools": ["Tool 1", "Tool 2"],
  "steps": ["Step 1, one clear action", "Step 2", "..."],
  "starter_prompt": "a ready-to-paste prompt or automation blueprint they can use to actually start, tailored to their business",
  "adapted_for": "one sentence naming how this is shaped to their specific business"
}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ ok: false, error: "ANTHROPIC_API_KEY not set" });

  let body: { input?: string; business_context?: Record<string, string> };
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad JSON body" }); }
  const input = String(body.input || "").trim();
  const ctx = body.business_context || {};
  if (!input) return json({ ok: false, error: "Paste a link or describe what you saw." });

  let sourceText = "", sourceNote = "", sourceUrl = "";
  if (isUrl(input)) {
    sourceUrl = input.trim();
    const s = await fetchSource(sourceUrl);
    sourceText = s.text; sourceNote = s.note;
  }

  let text = "";
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1800,
        messages: [{ role: "user", content: buildPrompt(input, sourceText, sourceNote, ctx) }],
      }),
    });
    const j = await r.json();
    if (j.error) return json({ ok: false, error: "LLM: " + (j.error.message || "error") });
    text = (j.content || []).map((c: any) => c.text || "").join("");
  } catch (e) {
    return json({ ok: false, error: "LLM call failed: " + ((e as Error).message || "unknown") });
  }

  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return json({ ok: false, error: "Could not read a build from the source. Try describing it in your own words." });
  let card: any;
  try { card = JSON.parse(text.slice(start, end + 1)); } catch { return json({ ok: false, error: "Could not parse the build. Try again." }); }

  const clean = (s: any) => String(s == null ? "" : s).replace(/[—–]/g, " ");
  const out = {
    title: clean(card.title) || "Your build",
    source_url: sourceUrl,
    what_it_does: clean(card.what_it_does),
    tools: Array.isArray(card.tools) ? card.tools.slice(0, 8).map(clean) : [],
    steps: Array.isArray(card.steps) ? card.steps.slice(0, 12).map(clean) : [],
    starter_prompt: clean(card.starter_prompt),
    adapted_for: clean(card.adapted_for),
  };
  if (!out.what_it_does && !out.steps.length) return json({ ok: false, error: "Came back empty. Try again or rephrase." });

  return json({ ok: true, card: out });
});
