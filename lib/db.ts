import { neon } from "@neondatabase/serverless";

let _sql: ReturnType<typeof neon> | null = null;

function client() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _sql = neon(url);
  }
  return _sql;
}

let schemaReady: Promise<void> | null = null;

// Idempotent; runs once per cold start so a fresh Neon database needs no manual migration.
export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = client();
      await sql`CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        source TEXT NOT NULL,
        external_id TEXT UNIQUE,
        text TEXT NOT NULL,
        captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        status TEXT NOT NULL DEFAULT 'new',
        score INT,
        verdict TEXT,
        triage_reason TEXT,
        triaged_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS drafts (
        id SERIAL PRIMARY KEY,
        note_ids INT[] NOT NULL,
        pillar TEXT,
        angle TEXT,
        why TEXT,
        instruction TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        stage TEXT,
        news JSONB,
        body TEXT,
        edited_body TEXT,
        facts_used JSONB,
        qa JSONB,
        attempts INT NOT NULL DEFAULT 0,
        error TEXT,
        tg_message_id BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS facts (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        source TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      const [{ n }] = (await sql`SELECT count(*)::int AS n FROM facts`) as { n: number }[];
      if (n === 0) {
        for (const f of SEED_FACTS) {
          await sql`INSERT INTO facts (text, source) VALUES (${f.text}, ${f.source})`;
        }
      }
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

// Only facts stated unambiguously in the voice spec. The founding-timeline and
// humid-city-returns figures are contradictory in the source material and are
// deliberately left out until Meera confirms them.
const SEED_FACTS = [
  { text: "Meera Pillai is the founder of Skinstinct, an Indian D2C skincare brand.", source: "voice spec" },
  { text: "Before Skinstinct, Meera spent 2 years in pharmaceutical formulation.", source: "voice spec" },
  { text: "Meera is not a dermatologist and does not have a medical degree.", source: "voice spec" },
  { text: "Skinstinct's repeat purchase rate is 67%. Meera can't separate the causes of it.", source: "voice spec" },
];

export async function db() {
  await ensureSchema();
  return client();
}

export type Note = {
  id: number;
  source: string;
  external_id: string | null;
  text: string;
  captured_at: string;
  status: "new" | "used" | "parked" | "skipped";
  score: number | null;
  verdict: string | null;
  triage_reason: string | null;
};

export type NewsAngle = {
  headline: string;
  publisher: string;
  url: string;
  published: string;
  summary: string;
  facts: { text: string; quote: string }[];
};

export type Draft = {
  id: number;
  note_ids: number[];
  pillar: string | null;
  angle: string | null;
  why: string | null;
  instruction: string | null;
  status: "queued" | "running" | "ready" | "failed" | "approved" | "posted" | "rejected";
  stage: string | null;
  news: NewsAngle | null;
  body: string | null;
  edited_body: string | null;
  facts_used: { text: string; source: string }[] | null;
  qa: import("./qa").QAReport | null;
  attempts: number;
  error: string | null;
  tg_message_id: number | null;
  created_at: string;
  updated_at: string;
};

export type Fact = { id: number; text: string; source: string | null };

export async function getDraft(id: number) {
  const sql = await db();
  const rows = (await sql`SELECT * FROM drafts WHERE id = ${id}`) as Draft[];
  return rows[0] ?? null;
}

export async function getNotes(ids: number[]) {
  const sql = await db();
  return (await sql`SELECT * FROM notes WHERE id = ANY(${ids}) ORDER BY captured_at`) as Note[];
}

export async function getFacts() {
  const sql = await db();
  return (await sql`SELECT * FROM facts ORDER BY id`) as Fact[];
}

export async function insertNote(n: {
  source: string;
  externalId?: string | null;
  text: string;
  capturedAt?: Date | string | null;
}) {
  const sql = await db();
  const text = n.text.trim();
  if (!text) return null;
  const captured = n.capturedAt ? new Date(n.capturedAt).toISOString() : new Date().toISOString();
  const rows = (await sql`
    INSERT INTO notes (source, external_id, text, captured_at)
    VALUES (${n.source}, ${n.externalId ?? null}, ${text}, ${captured})
    ON CONFLICT (external_id) DO NOTHING
    RETURNING id`) as { id: number }[];
  return rows[0]?.id ?? null;
}
