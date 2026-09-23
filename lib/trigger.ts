import { headers } from "next/headers";

export function appUrl(origin?: string) {
  return (process.env.APP_URL || origin || "").replace(/\/$/, "");
}

export async function originFromHeaders() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return appUrl(host ? `${proto}://${host}` : undefined);
}

// Each draft runs in its own function invocation so it gets the full
// maxDuration, instead of sharing one with triage or other drafts.
export async function triggerDraft(base: string, id: number) {
  const res = await fetch(`${base}/api/drafts/${id}/run`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  if (!res.ok) throw new Error(`Could not start draft #${id}: HTTP ${res.status}`);
}
