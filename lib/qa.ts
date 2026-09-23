// Automatable half of the voice-spec QA rubric (section 12, checks 1, 2, 3, 6, 7)
// plus a few non-scored format flags. The LLM judge covers checks 4, 5, 8, 9, 10.

export type Check = { id: number; name: string; pass: boolean; detail: string; source: "script" | "judge" };

export type QAReport = {
  score: number;
  pass: boolean;
  checks: Check[];
  flags: string[];
  wordCount: number;
  shortSentenceRatio: number;
  judgeNotes?: string[];
};

const BANNED_WORDS = [
  "delve", "delves", "delving", "unlock", "unlocks", "unlocking", "elevate", "elevates",
  "game-changer", "game changer", "journey", "crucial", "powerhouse", "holy grail",
  "leverage", "leveraging", "seamless", "seamlessly", "glow", "glowing", "radiant",
  "nourish", "nourishing", "pamper", "self-care", "incredibly", "amazing",
];
const BANNED_PHRASES = [
  "here's the thing", "let's", "in today's", "the truth is", "honestly,", "spoiler",
  "we're excited", "we're thrilled", "in short", "so there you have it", "dive in",
  "it's not just", "per cent",
];
// Only acceptable inside quotes, as claims under examination.
const QUOTED_ONLY = ["skin-loving", "clean beauty"];

export function normaliseDashes(text: string) {
  return text
    .replace(/(\d)\s*[—–]\s*(\d)/g, "$1-$2")
    .replace(/\s*[—–]\s*/g, " - ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

export function sentences(text: string) {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.?!:])\s+(?=["A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => /[a-z]/i.test(s));
}

function words(s: string) {
  return s.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
}

function stripQuoted(text: string) {
  return text.replace(/"[^"\n]*"/g, '""');
}

function numberTokens(text: string) {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.add(m[0].replace(/,/g, "").replace(/\.$/, ""));
  return out;
}

export function scriptChecks(post: string, allowedCorpus: string) {
  const checks: Check[] = [];
  const flags: string[] = [];

  const badPunct = [...new Set(post.match(/[!;—–]/g) ?? [])];
  checks.push({
    id: 1, name: "No ! ; — or –", source: "script", pass: badPunct.length === 0,
    detail: badPunct.length ? `Found: ${badPunct.join(" ")}` : "Clean",
  });

  const unquotedQs = (stripQuoted(post).match(/\?/g) ?? []).length;
  checks.push({
    id: 2, name: "No question to the reader", source: "script", pass: unquotedQs === 0,
    detail: unquotedQs ? `${unquotedQs} question mark(s) outside quoted speech` : "Clean",
  });

  const sents = sentences(post);
  const short = sents.filter((s) => words(s).length <= 8).length;
  const ratio = sents.length ? short / sents.length : 0;
  checks.push({
    id: 3, name: "18-30% short sentences", source: "script", pass: ratio >= 0.18 && ratio <= 0.3,
    detail: `${short}/${sents.length} sentences are 8 words or fewer (${Math.round(ratio * 100)}%)`,
  });

  const lower = post.toLowerCase();
  const unquotedLower = stripQuoted(post).toLowerCase();
  const hits = [
    ...BANNED_WORDS.filter((w) => new RegExp(`\\b${w.replace(/[-\s]/g, "[-\\s]")}\\b`).test(lower)),
    ...BANNED_PHRASES.filter((p) => lower.includes(p)),
    ...QUOTED_ONLY.filter((p) => unquotedLower.includes(p)),
  ];
  checks.push({
    id: 6, name: "No banned words", source: "script", pass: hits.length === 0,
    detail: hits.length ? `Found: ${hits.join(", ")}` : "Clean",
  });

  const allowed = numberTokens(allowedCorpus);
  const unknown = [...numberTokens(post)].filter((n) => !allowed.has(n));
  const badFormat: string[] = [];
  if (/\d\s+-\s+\d/.test(post)) badFormat.push("spaced range (use 4-5%)");
  if (/\d\s+%/.test(post)) badFormat.push("detached %");
  checks.push({
    id: 7, name: "Every number is sourced and formatted", source: "script",
    pass: unknown.length === 0 && badFormat.length === 0,
    detail: [
      unknown.length ? `Not in fact bank, notes or news: ${unknown.join(", ")}` : "",
      badFormat.join("; "),
    ].filter(Boolean).join(" · ") || "All numbers traced to a source",
  });

  const wordCount = words(post).length;
  if (wordCount < 350 || wordCount > 550) flags.push(`Length ${wordCount} words (target 350-550)`);
  if (/#\w/.test(post)) flags.push("Contains a hashtag");
  if (/\p{Extended_Pictographic}/u.test(post)) flags.push("Contains an emoji");
  if (/^(hi|hello|dear)\b/i.test(post.trim())) flags.push("Opens with a greeting");
  const long = sents.filter((s) => words(s).length >= 35).length;
  if (long > 2) flags.push(`${long} sentences over 35 words (max 1-2)`);

  return { checks, flags, wordCount, shortSentenceRatio: ratio };
}

export function combine(
  script: ReturnType<typeof scriptChecks>,
  judge: Check[],
  judgeNotes: string[],
): QAReport {
  const checks = [...script.checks, ...judge].sort((a, b) => a.id - b.id);
  const score = checks.filter((c) => c.pass).length;
  const hard = checks.filter((c) => [1, 6, 7].includes(c.id)).every((c) => c.pass);
  return {
    score,
    pass: score >= 8 && hard,
    checks,
    flags: script.flags,
    wordCount: script.wordCount,
    shortSentenceRatio: script.shortSentenceRatio,
    judgeNotes,
  };
}

export function feedbackFor(qa: QAReport) {
  return [
    ...qa.checks.filter((c) => !c.pass).map((c) => `Check ${c.id} (${c.name}) failed: ${c.detail}`),
    ...qa.flags,
    ...(qa.judgeNotes ?? []),
  ];
}
