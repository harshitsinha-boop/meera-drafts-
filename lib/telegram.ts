const API = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
  return json.result;
}

export function ownerChatId() {
  const id = process.env.TELEGRAM_OWNER_ID;
  return id ? Number(id) : null;
}

export async function notifyOwner(text: string, extra: Record<string, unknown> = {}) {
  const chat_id = ownerChatId();
  if (!chat_id || !process.env.TELEGRAM_BOT_TOKEN) return null;
  return tg<{ message_id: number }>("sendMessage", {
    chat_id,
    text: text.slice(0, 4096),
    link_preview_options: { is_disabled: true },
    ...extra,
  });
}

// Telegram delivers text either as a string or, in exports, as an array of
// plain strings and entity objects ({ type, text }).
export function flattenText(t: unknown): string {
  if (typeof t === "string") return t;
  if (Array.isArray(t)) return t.map((p) => (typeof p === "string" ? p : (p as { text?: string }).text ?? "")).join("");
  return "";
}

export type TgMessage = {
  message_id: number;
  date: number;
  chat: { id: number; type: string; title?: string };
  from?: { id: number; first_name?: string };
  text?: string;
  caption?: string;
  forward_origin?: { type: string; chat?: { id: number; title?: string }; message_id?: number };
};

export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  channel_post?: TgMessage;
  edited_channel_post?: TgMessage;
  callback_query?: {
    id: string;
    from: { id: number };
    data?: string;
    message?: TgMessage;
  };
};
