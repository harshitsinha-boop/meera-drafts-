import { createHash, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "md_session";

export function hashPassword(pw: string) {
  return createHash("sha256").update(`meera-drafts:${pw}`).digest("hex");
}

export function sessionToken() {
  const pw = process.env.DASHBOARD_PASSWORD;
  return pw ? hashPassword(pw) : null;
}

export function safeEqual(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Cron jobs and internal draft triggers authenticate with CRON_SECRET.
export function isInternal(req: Request) {
  const secret = process.env.CRON_SECRET;
  return !!secret && safeEqual(req.headers.get("authorization"), `Bearer ${secret}`);
}
