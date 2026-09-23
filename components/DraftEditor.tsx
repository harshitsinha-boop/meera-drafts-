"use client";
import { useState } from "react";
import { saveDraft } from "@/app/actions";

export function DraftEditor({ id, initial, status }: { id: number; initial: string; status: string }) {
  const [body, setBody] = useState(initial);
  const [copied, setCopied] = useState(false);
  const words = body.split(/\s+/).filter(Boolean).length;

  return (
    <form action={saveDraft} className="stack">
      <input type="hidden" name="id" value={id} />
      <textarea className="post" name="body" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="row spread">
        <span className={`small ${words < 350 || words > 550 ? "muted" : ""}`}>
          {words} words {words < 350 || words > 550 ? "(target 350-550)" : ""}
        </span>
        <div className="row">
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(body);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button name="intent" value="save">Save edits</button>
          {status !== "approved" && status !== "posted" && (
            <button name="intent" value="approve" className="primary">Approve</button>
          )}
          {status === "approved" && (
            <button name="intent" value="posted" className="primary">Mark as posted</button>
          )}
        </div>
      </div>
    </form>
  );
}
