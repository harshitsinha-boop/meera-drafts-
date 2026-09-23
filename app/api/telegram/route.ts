import { after } from "next/server";
import { safeEqual } from "@/lib/auth";
import { db, insertNote } from "@/lib/db";
import { triage } from "@/lib/pipeline";
import { appUrl, triggerDraft } from "@/lib/trigger";
import { tg, ownerChatId, type TgUpdate, type TgMessage } from "@/lib/telegram";

export const maxDuration = 120;

const HELP = `I turn the notes you drop into your channel into LinkedIn drafts.

Post in the channel as usual - I pick up every message. You can also message me directly and I'll save it as a note.

/draft - pick the strongest note(s) and draft now (add a number for up to 3)
/queue - what's waiting
/help - this message

Drafts arrive here with Approve / Redo / Skip buttons. Nothing is ever posted for you.`;

export async function POST(req: Request) {
  if (!safeEqual(req.headers.get("x-telegram-bot-api-secret-token"), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const update = (await req.json()) as TgUpdate;
  const base = appUrl(new URL(req.url).origin);
  try {
    await handle(update, base);
  } catch (e) {
    // Always 200 so Telegram doesn't retry the same update forever.
    console.error("telegram update failed", e);
  }
  return Response.json({ ok: true });
}

function noteText(m: TgMessage) {
  return (m.text ?? m.caption ?? "").trim();
}

async function reply(chatId: number, text: string) {
  await tg("sendMessage", { chat_id: chatId, text, link_preview_options: { is_disabled: true } });
}

async function handle(update: TgUpdate, base: string) {
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  const owner = ownerChatId();

  // Notes from Meera's channel
  const post = update.channel_post ?? update.edited_channel_post;
  if (post) {
    if (!channelId || String(post.chat.id) !== channelId) return;
    const text = noteText(post);
    if (!text) return;
    const externalId = `tgch:${post.message_id}`;
    if (update.edited_channel_post) {
      const sql = await db();
      await sql`UPDATE notes SET text = ${text} WHERE external_id = ${externalId} AND status IN ('new', 'parked')`;
    } else {
      await insertNote({ source: "telegram", externalId, text, capturedAt: new Date(post.date * 1000) });
    }
    return;
  }

  // Inline buttons on a delivered draft
  const cb = update.callback_query;
  if (cb) {
    if (cb.from.id !== owner) return;
    const [action, rawId] = (cb.data ?? "").split(":");
    const id = Number(rawId);
    const sql = await db();
    let answer = "";
    if (action === "approve") {
      await sql`UPDATE drafts SET status = 'approved', updated_at = now() WHERE id = ${id} AND status = 'ready'`;
      answer = `Draft #${id} approved. Copy it from the message above or the dashboard.`;
    } else if (action === "reject") {
      await sql`UPDATE drafts SET status = 'rejected', updated_at = now() WHERE id = ${id} AND status IN ('ready', 'failed')`;
      answer = `Draft #${id} skipped.`;
    } else if (action === "redo") {
      after(() => triggerDraft(base, id));
      answer = `Redrafting #${id}. A new version will arrive in a few minutes.`;
    }
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: answer.slice(0, 190) });
    if (answer && cb.message) {
      await tg("editMessageReplyMarkup", {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
      await reply(cb.message.chat.id, answer);
    }
    return;
  }

  const m = update.message;
  if (!m || m.chat.type !== "private") return;

  if (m.text?.startsWith("/start") || (m.text?.startsWith("/") && m.from?.id !== owner)) {
    if (m.from?.id !== owner) {
      await reply(m.chat.id, `Your Telegram user id is ${m.from?.id}. Set TELEGRAM_OWNER_ID to this value in Vercel to connect this bot to you.`);
    } else {
      await reply(m.chat.id, HELP);
    }
    return;
  }
  if (m.from?.id !== owner) return;

  const [cmd, arg] = (m.text ?? "").trim().split(/\s+/);
  if (cmd === "/help") return reply(m.chat.id, HELP);

  if (cmd === "/queue") {
    const sql = await db();
    const [c] = (await sql`
      SELECT
        (SELECT count(*)::int FROM notes WHERE status = 'new') AS fresh,
        (SELECT count(*)::int FROM notes WHERE status = 'parked') AS parked,
        (SELECT count(*)::int FROM drafts WHERE status = 'ready') AS ready,
        (SELECT count(*)::int FROM drafts WHERE status IN ('queued', 'running')) AS running`) as {
      fresh: number; parked: number; ready: number; running: number;
    }[];
    return reply(
      m.chat.id,
      `${c.fresh} new note(s), ${c.parked} parked.\n${c.ready} draft(s) waiting for you, ${c.running} in progress.`,
    );
  }

  if (cmd === "/draft") {
    const count = Math.min(Math.max(Number(arg) || 1, 1), 3);
    await reply(m.chat.id, `Reading your notes and picking ${count === 1 ? "the strongest one" : `the ${count} strongest`}. Drafts take a few minutes each.`);
    after(async () => {
      try {
        const ids = await triage(count);
        if (!ids.length) return reply(m.chat.id, "Nothing in the queue is ready to draft. Drop a few more notes and try again.");
        for (const id of ids) await triggerDraft(base, id);
      } catch (e) {
        await reply(m.chat.id, `Triage failed: ${e instanceof Error ? e.message : e}`);
      }
    });
    return;
  }

  if (cmd.startsWith("/")) return reply(m.chat.id, HELP);

  // Anything else Meera sends directly is a note. Forwards from her channel also
  // reveal the channel id she needs for TELEGRAM_CHANNEL_ID.
  const text = noteText(m);
  if (!text) return reply(m.chat.id, "I can only save text notes for now.");
  const fwdChat = m.forward_origin?.chat;
  const externalId = fwdChat && m.forward_origin?.message_id && String(fwdChat.id) === channelId
    ? `tgch:${m.forward_origin.message_id}`
    : `tgdm:${m.message_id}`;
  const id = await insertNote({ source: "telegram", externalId, text, capturedAt: new Date(m.date * 1000) });
  const lines = [id ? `Saved as note #${id}.` : "Already had that one."];
  if (fwdChat && !channelId) lines.push(`That channel's id is ${fwdChat.id} - set TELEGRAM_CHANNEL_ID to it so I read the channel directly.`);
  await reply(m.chat.id, lines.join("\n"));
}
