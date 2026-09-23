import { after } from "next/server";
import { isInternal } from "@/lib/auth";
import { runDraft } from "@/lib/pipeline";
import { appUrl } from "@/lib/trigger";

export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isInternal(req)) return new Response("Unauthorized", { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return new Response("Bad id", { status: 400 });
  const base = appUrl(new URL(req.url).origin);
  after(() => runDraft(id, base));
  return Response.json({ started: id }, { status: 202 });
}
