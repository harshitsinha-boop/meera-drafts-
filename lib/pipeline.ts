import { z } from "zod";
import { generateJson, groundedSearch, pageText } from "./llm";
import { db, getDraft, getNotes, getFacts, type Draft, type Note, type NewsAngle, type Fact } from "./db";
import { PILLARS, VOICE_SYSTEM_PROMPT } from "./voice";
import { scriptChecks, combine, feedbackFor, normaliseDashes, type Check, type QAReport } from "./qa";
import { notifyOwner } from "./telegram";

const MAX_ATTEMPTS = 2;
const TRIAGE_POOL = 150;
const TRIAGE_CHARS = 1500;

// ---------------------------------------------------------------- triage

const TriageSchema = z.object({
  assessments: z.array(
    z.object({
      id: z.number().int(),
      score: z.number().int().describe("1-5: how strong a LinkedIn post this could become"),
      verdict: z.enum(["develop", "combine", "park", "skip"]),
      reason: z.string(),
    }),
  ),
  picks: z.array(
    z.object({
      note_ids: z.array(z.number().int()).describe("One note, or several that belong in one post"),
      pillar: z.enum(PILLARS),
      angle: z.string().describe("The single argument the post will make, in one sentence"),
      why: z.string().describe("Why this is worth posting now, in one sentence Meera can scan"),
    }),
  ),
});

const TRIAGE_SYSTEM = `You triage raw notes for Meera Pillai, founder of Skinstinct (Indian D2C skincare, ex-pharma formulation). She captures notes constantly but they never become posts. You decide which notes are worth developing into a LinkedIn post this week.

Her posts always close a gap between a skincare claim and the formulation evidence behind it, and she holds her own brand to the same standard. Content pillars: ${PILLARS.join(", ")}.

A strong note has: a specific observation (a number, a batch, a customer question, a label she read), a tension between what's claimed and what's true, and something only a formulator-founder would notice. A weak note is a generic opinion, a to-do, a link with no reaction, or something that needs facts she hasn't captured.

Notes marked source "drive_draft" are posts she started and abandoned. She already chose those topics, so rate them generously if the idea is intact.

Two weak notes on the same theme can make one strong post: pick them together ("combine"). Avoid angles that repeat recent posts. Score every note in the pool; "park" means keep for later, "skip" means not post material.`;

export async function triage(count: number) {
  const sql = await db();
  const pool = (await sql`
    SELECT * FROM notes WHERE status IN ('new', 'parked')
    ORDER BY (source = 'drive_draft') DESC, captured_at DESC LIMIT ${TRIAGE_POOL}`) as Note[];
  if (pool.length === 0) return [];

  const recent = (await sql`
    SELECT pillar, angle FROM drafts WHERE status <> 'rejected'
    ORDER BY created_at DESC LIMIT 12`) as Pick<Draft, "pillar" | "angle">[];

  const notesBlock = pool
    .map((n) => {
      const text = n.text.length > TRIAGE_CHARS ? n.text.slice(0, TRIAGE_CHARS) + " [...]" : n.text;
      return `<note id="${n.id}" source="${n.source}" captured="${n.captured_at.slice?.(0, 10) ?? n.captured_at}" status="${n.status}">\n${text}\n</note>`;
    })
    .join("\n\n");

  const out = await generateJson("triage", TriageSchema, {
    system: TRIAGE_SYSTEM,
    prompt: `Recent post angles (don't repeat these):\n${recent.map((r) => `- [${r.pillar}] ${r.angle}`).join("\n") || "- none yet"}\n\nNote pool:\n\n${notesBlock}\n\nPick the ${count} strongest post(s) to draft now, and assess every note.`,
  });

  const poolIds = new Set(pool.map((n) => n.id));
  for (const a of out.assessments) {
    if (!poolIds.has(a.id)) continue;
    const status = a.verdict === "skip" ? "skipped" : a.verdict === "park" ? "parked" : null;
    await sql`
      UPDATE notes SET score = ${a.score}, verdict = ${a.verdict}, triage_reason = ${a.reason},
        triaged_at = now(), status = COALESCE(${status}, status)
      WHERE id = ${a.id} AND status IN ('new', 'parked')`;
  }

  const created: number[] = [];
  const used = new Set<number>();
  for (const p of out.picks.slice(0, count)) {
    const ids = p.note_ids.filter((id) => poolIds.has(id) && !used.has(id));
    if (!ids.length) continue;
    ids.forEach((id) => used.add(id));
    const [row] = (await sql`
      INSERT INTO drafts (note_ids, pillar, angle, why)
      VALUES (${ids}, ${p.pillar}, ${p.angle}, ${p.why}) RETURNING id`) as { id: number }[];
    await sql`UPDATE notes SET status = 'used' WHERE id = ANY(${ids})`;
    created.push(row.id);
  }
  return created;
}

// Create a draft from notes Meera picked herself (dashboard or bot).
export async function draftFromNotes(noteIds: number[], instruction?: string) {
  const sql = await db();
  const notes = await getNotes(noteIds);
  if (!notes.length) throw new Error("No such notes");
  const [row] = (await sql`
    INSERT INTO drafts (note_ids, angle, instruction, why)
    VALUES (${notes.map((n) => n.id)}, ${null}, ${instruction ?? null}, ${"Picked by Meera"})
    RETURNING id`) as { id: number }[];
  await sql`UPDATE notes SET status = 'used' WHERE id = ANY(${notes.map((n) => n.id)})`;
  return row.id;
}

// ---------------------------------------------------------------- news angle

const NewsPickSchema = z.object({
  found: z.boolean(),
  source_index: z.number().int().describe("Number of the source in the list that the news item comes from; 0 if none"),
  headline: z.string(),
  publisher: z.string(),
  published: z.string().describe("YYYY-MM-DD, or empty if unknown"),
  summary: z.string().describe("2-3 sentences on what it says and why it connects to the note"),
  facts: z.array(z.object({ text: z.string(), quote: z.string() })),
});

async function findNewsAngle(notes: Note[], draft: Draft): Promise<NewsAngle | null> {
  const today = new Date().toISOString().slice(0, 10);
  const brief = `Meera Pillai (founder of Skinstinct, Indian D2C skincare) is writing a LinkedIn post from these notes:

${notes.map((n) => `<note>\n${n.text}\n</note>`).join("\n")}

${draft.angle ? `Planned angle: ${draft.angle}\n` : ""}${draft.instruction ? `Meera's instruction: ${draft.instruction}\n` : ""}`;

  // Step 1: grounded search.
  const search = await groundedSearch(
    "news search",
    `Today is ${today}. ${brief}
Search for ONE current news item or industry data point (published in roughly the last 60 days) that gives this post a timely way in: e.g. a CDSCO or BIS regulatory move, an ASCI advertising ruling, a published study, an Indian beauty-market report, a brand recall or labelling controversy. Prefer primary or reputable sources. It must genuinely connect to the note - a loose "skincare is growing" market stat is worse than nothing.

Report what you found: headline, publisher, date, what it says, and any specific figures exactly as the source states them. If nothing current genuinely fits, say so plainly.`,
  );
  if (!search.sources.length) return null;

  // Step 2: pick one item and tie it to a numbered source.
  const pick = await generateJson("news pick", NewsPickSchema, {
    system: "You extract one news item from search findings. Never add information that isn't in the findings.",
    prompt: `${brief}
<findings>
${search.text}
</findings>

<sources>
${search.sources.map((s) => `[${s.index}] ${s.title} - ${s.url}`).join("\n")}
</sources>

If the findings contain a current item that genuinely fits the note, return it with the number of its source. Otherwise return found=false. Only include facts stated in the findings; every number in a fact must appear in its quote.`,
  });
  const source = search.sources.find((s) => s.index === pick.source_index);
  if (!pick.found || !source) return null;

  // Keep a figure only if it appears on the actual source page.
  const page = await pageText(source.url);
  const facts = pick.facts.filter((f) => {
    const nums = f.text.match(/\d[\d,.]*/g) ?? [];
    if (!nums.length) return true;
    return !!page && nums.every((n) => page.includes(n.replace(/\.$/, "")));
  });

  return {
    headline: pick.headline,
    publisher: pick.publisher || new URL(source.url).hostname.replace(/^www\./, ""),
    url: source.url,
    published: pick.published,
    summary: pick.summary,
    facts,
  };
}

// ---------------------------------------------------------------- drafting

const DraftSchema = z.object({
  post: z.string().describe("The full LinkedIn post, paragraphs separated by a blank line"),
  facts_used: z.array(
    z.object({
      text: z.string().describe("Every number, date, or factual claim that appears in the post"),
      source: z.enum(["fact_bank", "note", "news"]),
    }),
  ),
});

async function voiceExamples() {
  const sql = await db();
  return (await sql`
    SELECT edited_body FROM drafts
    WHERE status IN ('approved', 'posted') AND edited_body IS NOT NULL AND edited_body <> body
    ORDER BY updated_at DESC LIMIT 3`) as { edited_body: string }[];
}

async function writeDraft(ctx: {
  draft: Draft;
  notes: Note[];
  facts: Fact[];
  news: NewsAngle | null;
  feedback?: { previous: string; issues: string[] };
}) {
  const examples = await voiceExamples();
  const parts = [
    `<fact_bank>\n${ctx.facts.map((f) => `- ${f.text}`).join("\n")}\n</fact_bank>`,
    `<notes>\n${ctx.notes.map((n) => `<note source="${n.source}" captured="${String(n.captured_at).slice(0, 10)}">\n${n.text}\n</note>`).join("\n")}\n</notes>`,
    ctx.news
      ? `<news_item>\nHeadline: ${ctx.news.headline}\nPublisher: ${ctx.news.publisher}\nPublished: ${ctx.news.published}\nSummary: ${ctx.news.summary}\nVerified facts:\n${ctx.news.facts.map((f) => `- ${f.text}`).join("\n") || "- (none with figures)"}\n</news_item>`
      : `<news_item>None found. Write the post from the notes alone.</news_item>`,
    examples.length
      ? `<approved_posts>\nPosts Meera approved after editing. Her edits are the best evidence of her voice - match them.\n\n${examples.map((e) => e.edited_body).join("\n\n---\n\n")}\n</approved_posts>`
      : "",
    ctx.draft.pillar ? `Pillar: ${ctx.draft.pillar}` : "",
    ctx.draft.angle ? `Angle: ${ctx.draft.angle}` : "",
    ctx.draft.instruction ? `Meera's instruction for this post: ${ctx.draft.instruction}` : "",
    ctx.feedback
      ? `<previous_draft>\n${ctx.feedback.previous}\n</previous_draft>\nThis draft failed QA. Fix these problems and keep what worked:\n${ctx.feedback.issues.map((i) => `- ${i}`).join("\n")}`
      : "",
    "Write the LinkedIn post.",
  ].filter(Boolean);

  const out = await generateJson("draft", DraftSchema, {
    system: VOICE_SYSTEM_PROMPT,
    prompt: parts.join("\n\n"),
    thinking: "high",
  });
  return { ...out, post: normaliseDashes(out.post.trim()) };
}

// ---------------------------------------------------------------- QA judge

const verdict = z.object({ pass: z.boolean(), detail: z.string() });
const JudgeSchema = z.object({
  colon_reveal: verdict.describe("Check 4: at least one colon reveals an answer after a setup"),
  it_is_verdict: verdict.describe('Check 5: at least one verdict sentence uses the full form "It is"'),
  boundary_line: verdict.describe(`Check 8: exactly one boundary line ("I'm not saying X. I'm saying Y." or equivalent)`),
  ending: verdict.describe("Check 9: ending is an instruction, commitment or disclosure - not a summary or CTA"),
  evidence_strength: verdict.describe("Check 10: evidence strength named at least once (in-vitro, sample size, study design...)"),
  voice_issues: z.array(z.string()).describe("Specific lines that don't sound like Meera, and what she'd write instead. Empty if none."),
});

async function judge(post: string): Promise<{ checks: Check[]; notes: string[] }> {
  const j = await generateJson("judge", JudgeSchema, {
    system: `You are a strict editor checking a LinkedIn post against Meera Pillai's voice specification. Judge only what is on the page. Here is the spec the writer was given:\n\n${VOICE_SYSTEM_PROMPT}`,
    prompt: `<post>\n${post}\n</post>\n\nGrade checks 4, 5, 8, 9 and 10, and list any voice issues.`,
  });
  const row = (id: number, name: string, v: { pass: boolean; detail: string }): Check => ({ id, name, source: "judge", ...v });
  return {
    checks: [
      row(4, "Colon reveals an answer", j.colon_reveal),
      row(5, 'Verdict uses full "It is"', j.it_is_verdict),
      row(8, "Exactly one boundary line", j.boundary_line),
      row(9, "Ends on instruction/commitment/disclosure", j.ending),
      row(10, "Evidence strength named", j.evidence_strength),
    ],
    notes: j.voice_issues,
  };
}

// ---------------------------------------------------------------- orchestration

async function setStage(id: number, stage: string) {
  const sql = await db();
  await sql`UPDATE drafts SET stage = ${stage}, updated_at = now() WHERE id = ${id}`;
}

export async function runDraft(id: number, dashboardUrl?: string) {
  const sql = await db();
  const claimed = (await sql`
    UPDATE drafts SET status = 'running', stage = 'starting', error = NULL, updated_at = now()
    WHERE id = ${id} AND status IN ('queued', 'failed', 'ready', 'rejected')
    RETURNING id`) as { id: number }[];
  if (!claimed.length) return; // already running or already approved

  try {
    const draft = (await getDraft(id))!;
    const [notes, facts] = await Promise.all([getNotes(draft.note_ids), getFacts()]);

    await setStage(id, "finding a news angle");
    let news: NewsAngle | null = null;
    try {
      news = await findNewsAngle(notes, draft);
    } catch (e) {
      console.error(`draft ${id}: news search failed, continuing without`, e);
    }
    await sql`UPDATE drafts SET news = ${news ? JSON.stringify(news) : null}::jsonb WHERE id = ${id}`;

    const allowedCorpus = [
      ...facts.map((f) => f.text),
      ...notes.map((n) => n.text),
      ...(news?.facts.map((f) => `${f.text} ${f.quote}`) ?? []),
      news?.published ?? "",
    ].join("\n");

    let best: { post: string; facts_used: { text: string; source: string }[]; qa: QAReport } | null = null;
    let feedback: { previous: string; issues: string[] } | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await setStage(id, attempt === 1 ? "drafting" : `redrafting (attempt ${attempt})`);
      const out = await writeDraft({ draft, notes, facts, news, feedback });

      await setStage(id, "checking voice and facts");
      const script = scriptChecks(out.post, allowedCorpus);
      const j = await judge(out.post);
      const qa = combine(script, j.checks, j.notes);

      await sql`UPDATE drafts SET attempts = ${attempt} WHERE id = ${id}`;
      if (!best || qa.score > best.qa.score) best = { ...out, qa };
      if (qa.pass) break;
      feedback = { previous: out.post, issues: feedbackFor(qa) };
    }

    await sql`
      UPDATE drafts SET status = 'ready', stage = NULL, body = ${best!.post}, edited_body = NULL,
        facts_used = ${JSON.stringify(best!.facts_used)}::jsonb, qa = ${JSON.stringify(best!.qa)}::jsonb,
        updated_at = now()
      WHERE id = ${id}`;

    await deliver(id, dashboardUrl);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`draft ${id} failed`, e);
    await sql`UPDATE drafts SET status = 'failed', stage = NULL, error = ${message}, updated_at = now() WHERE id = ${id}`;
    await notifyOwner(`Draft #${id} failed: ${message.slice(0, 300)}`).catch(() => {});
  }
}

export async function deliver(id: number, dashboardUrl?: string) {
  const d = await getDraft(id);
  if (!d?.body || !d.qa) return;
  const header = [
    `Draft #${d.id}${d.pillar ? ` · ${d.pillar}` : ""}`,
    `QA ${d.qa.score}/10${d.qa.pass ? "" : " - needs a closer look"}`,
    d.news ? `News angle: ${d.news.publisher || d.news.headline} ${d.news.url}` : "No news angle used",
  ].join("\n");
  const buttons: { text: string; callback_data?: string; url?: string }[][] = [
    [
      { text: "Approve", callback_data: `approve:${d.id}` },
      { text: "Redo", callback_data: `redo:${d.id}` },
      { text: "Skip", callback_data: `reject:${d.id}` },
    ],
  ];
  if (dashboardUrl?.startsWith("https://")) buttons.push([{ text: "Edit in dashboard", url: `${dashboardUrl}/drafts/${d.id}` }]);

  const body = d.body.length + header.length > 3900 ? d.body.slice(0, 3800 - header.length) + "\n[...]" : d.body;
  const sent = await notifyOwner(`${header}\n\n${body}`, { reply_markup: { inline_keyboard: buttons } });
  if (sent) {
    const sql = await db();
    await sql`UPDATE drafts SET tg_message_id = ${sent.message_id} WHERE id = ${id}`;
  }
}
