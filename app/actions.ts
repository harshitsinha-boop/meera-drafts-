"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import mammoth from "mammoth";
import { SESSION_COOKIE, sessionToken, safeEqual, hashPassword } from "@/lib/auth";
import { db, insertNote } from "@/lib/db";
import { triage, draftFromNotes } from "@/lib/pipeline";
import { originFromHeaders, triggerDraft } from "@/lib/trigger";
import { tg, flattenText } from "@/lib/telegram";

// ---------------------------------------------------------------- session

export async function login(_: unknown, form: FormData) {
  const token = sessionToken();
  if (!token) return { error: "DASHBOARD_PASSWORD is not set on the server." };
  if (!safeEqual(hashPassword(String(form.get("password") ?? "")), token)) return { error: "Wrong password." };
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 90,
    path: "/",
  });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

// ---------------------------------------------------------------- drafting

export async function runTriage(form: FormData) {
  const count = Math.min(Math.max(Number(form.get("count")) || 1, 1), 3);
  const ids = await triage(count);
  const base = await originFromHeaders();
  for (const id of ids) await triggerDraft(base, id);
  revalidatePath("/");
  revalidatePath("/notes");
}

export async function draftSelected(form: FormData) {
  const ids = form.getAll("note").map(Number).filter(Number.isInteger);
  if (!ids.length) return;
  const instruction = String(form.get("instruction") ?? "").trim() || undefined;
  const id = await draftFromNotes(ids, instruction);
  await triggerDraft(await originFromHeaders(), id);
  redirect(`/drafts/${id}`);
}

export async function redo(form: FormData) {
  const id = Number(form.get("id"));
  const instruction = String(form.get("instruction") ?? "").trim();
  const sql = await db();
  if (instruction) await sql`UPDATE drafts SET instruction = ${instruction} WHERE id = ${id}`;
  await triggerDraft(await originFromHeaders(), id);
  revalidatePath(`/drafts/${id}`);
}

export async function saveDraft(form: FormData) {
  const id = Number(form.get("id"));
  const body = String(form.get("body") ?? "").replace(/\r\n/g, "\n").trim();
  const intent = String(form.get("intent") ?? "save");
  const sql = await db();
  const status = intent === "approve" ? "approved" : intent === "posted" ? "posted" : null;
  await sql`
    UPDATE drafts SET edited_body = ${body}, status = COALESCE(${status}, status), updated_at = now()
    WHERE id = ${id}`;
  revalidatePath(`/drafts/${id}`);
  revalidatePath("/");
}

export async function setDraftStatus(form: FormData) {
  const id = Number(form.get("id"));
  const status = String(form.get("status"));
  if (!["ready", "approved", "posted", "rejected"].includes(status)) return;
  const sql = await db();
  await sql`UPDATE drafts SET status = ${status}, updated_at = now() WHERE id = ${id}`;
  revalidatePath(`/drafts/${id}`);
  revalidatePath("/");
}

// ---------------------------------------------------------------- notes

export async function addNote(form: FormData) {
  const text = String(form.get("text") ?? "");
  await insertNote({ source: "dashboard", text });
  revalidatePath("/notes");
}

export async function setNoteStatus(form: FormData) {
  const id = Number(form.get("id"));
  const status = String(form.get("status"));
  if (!["new", "parked", "skipped"].includes(status)) return;
  const sql = await db();
  await sql`UPDATE notes SET status = ${status} WHERE id = ${id}`;
  revalidatePath("/notes");
}

// ---------------------------------------------------------------- fact bank

export async function addFact(form: FormData) {
  const text = String(form.get("text") ?? "").trim();
  const source = String(form.get("source") ?? "").trim() || null;
  if (!text) return;
  const sql = await db();
  await sql`INSERT INTO facts (text, source) VALUES (${text}, ${source})`;
  revalidatePath("/facts");
}

export async function updateFact(form: FormData) {
  const id = Number(form.get("id"));
  const text = String(form.get("text") ?? "").trim();
  const source = String(form.get("source") ?? "").trim() || null;
  const sql = await db();
  if (!text) await sql`DELETE FROM facts WHERE id = ${id}`;
  else await sql`UPDATE facts SET text = ${text}, source = ${source} WHERE id = ${id}`;
  revalidatePath("/facts");
}

// ---------------------------------------------------------------- imports

type ImportResult = { message: string } | null;

export async function importTelegramExport(_: ImportResult, form: FormData): Promise<ImportResult> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { message: "Choose the result.json file from the export." };
  let data: { messages?: { id: number; type: string; date: string; text: unknown }[] };
  try {
    data = JSON.parse(await file.text());
  } catch {
    return { message: "That file isn't valid JSON. Export with format set to \"Machine-readable JSON\"." };
  }
  let added = 0;
  let seen = 0;
  for (const m of data.messages ?? []) {
    if (m.type !== "message") continue;
    const text = flattenText(m.text).trim();
    if (!text) continue;
    seen++;
    const id = await insertNote({ source: "telegram_import", externalId: `tgch:${m.id}`, text, capturedAt: m.date });
    if (id) added++;
  }
  revalidatePath("/notes");
  return { message: `Imported ${added} new note(s) from ${seen} text message(s). Duplicates were skipped.` };
}

export async function importDrafts(_: ImportResult, form: FormData): Promise<ImportResult> {
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const pasted = String(form.get("pasted") ?? "").trim();
  let added = 0;
  const skipped: string[] = [];

  for (const f of files) {
    let text = "";
    if (/\.docx$/i.test(f.name)) {
      text = (await mammoth.extractRawText({ buffer: Buffer.from(await f.arrayBuffer()) })).value;
    } else if (/\.(txt|md)$/i.test(f.name)) {
      text = await f.text();
    } else {
      skipped.push(f.name);
      continue;
    }
    const title = f.name.replace(/\.(docx|txt|md)$/i, "");
    const id = await insertNote({
      source: "drive_draft",
      externalId: `drive:${f.name}:${f.size}`,
      text: `[Abandoned draft: ${title}]\n\n${text.trim()}`,
      capturedAt: f.lastModified ? new Date(f.lastModified) : null,
    });
    if (id) added++;
  }
  if (pasted) {
    for (const chunk of pasted.split(/\n-{3,}\n/)) {
      if (await insertNote({ source: "drive_draft", text: `[Abandoned draft]\n\n${chunk.trim()}` })) added++;
    }
  }
  revalidatePath("/notes");
  return {
    message: `Imported ${added} draft(s).${skipped.length ? ` Skipped unsupported files: ${skipped.join(", ")}.` : ""}`,
  };
}

// ---------------------------------------------------------------- telegram setup

export async function connectTelegram(): Promise<ImportResult> {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_WEBHOOK_SECRET) {
    return { message: "Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET first." };
  }
  const base = await originFromHeaders();
  if (!base.startsWith("https://")) return { message: `Telegram needs a public https URL. Current: ${base}` };
  await tg("setWebhook", {
    url: `${base}/api/telegram`,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "channel_post", "edited_channel_post", "callback_query"],
    drop_pending_updates: false,
  });
  await tg("setMyCommands", {
    commands: [
      { command: "draft", description: "Pick the strongest note and draft it now" },
      { command: "queue", description: "What's waiting" },
      { command: "help", description: "How this works" },
    ],
  });
  return { message: `Webhook set to ${base}/api/telegram.` };
}
