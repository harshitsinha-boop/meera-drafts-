import { GoogleGenAI, ThinkingLevel, type GenerateContentResponse } from "@google/genai";
import { z } from "zod";

export const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

let _client: GoogleGenAI | null = null;
function gemini() {
  if (!_client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
}

function assertFinished(res: GenerateContentResponse, step: string) {
  const blocked = res.promptFeedback?.blockReason;
  if (blocked) throw new Error(`${step}: prompt blocked (${blocked})`);
  const reason = res.candidates?.[0]?.finishReason;
  if (reason && reason !== "STOP") throw new Error(`${step}: generation stopped (${reason})`);
  if (!res.text) throw new Error(`${step}: empty response`);
}

// Gemini accepts a subset of JSON Schema: drop the draft marker and the
// safe-integer bounds zod adds to every .int().
function jsonSchemaFor(schema: z.ZodType) {
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "$schema") continue;
      if ((k === "minimum" || k === "maximum") && Math.abs(v as number) >= Number.MAX_SAFE_INTEGER) continue;
      out[k] = clean(v);
    }
    return out;
  };
  return clean(z.toJSONSchema(schema));
}

export async function generateJson<S extends z.ZodType>(
  step: string,
  schema: S,
  opts: { system: string; prompt: string; thinking?: "low" | "high" },
): Promise<z.infer<S>> {
  const res = await gemini().models.generateContent({
    model: MODEL,
    contents: opts.prompt,
    config: {
      systemInstruction: opts.system,
      responseMimeType: "application/json",
      responseJsonSchema: jsonSchemaFor(schema),
      thinkingConfig: { thinkingLevel: opts.thinking === "high" ? ThinkingLevel.HIGH : ThinkingLevel.LOW },
    },
  });
  assertFinished(res, step);
  const parsed = schema.safeParse(JSON.parse(res.text!));
  if (!parsed.success) throw new Error(`${step}: response didn't match schema: ${parsed.error.message.slice(0, 300)}`);
  return parsed.data;
}

export type Source = { index: number; title: string; url: string };

// Google Search grounding returns redirect links (vertexaisearch.cloud.google.com);
// follow one hop to get the publisher's real URL.
async function resolveRedirect(uri: string) {
  try {
    const res = await fetch(uri, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    return res.headers.get("location") || uri;
  } catch {
    return uri;
  }
}

export async function groundedSearch(step: string, prompt: string) {
  const res = await gemini().models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });
  assertFinished(res, step);
  const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const sources: Source[] = [];
  for (const [i, c] of chunks.entries()) {
    if (!c.web?.uri) continue;
    sources.push({ index: i + 1, title: c.web.title ?? "", url: await resolveRedirect(c.web.uri) });
  }
  return { text: res.text!, sources };
}

// Plain text of a web page, for checking that quoted figures really appear in the source.
export async function pageText(url: string) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; DraftDesk/1.0)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ");
  } catch {
    return null;
  }
}
