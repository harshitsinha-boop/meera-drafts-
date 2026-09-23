import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDraft, getNotes } from "@/lib/db";
import { when, STATUS_TONE } from "@/lib/format";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DraftEditor } from "@/components/DraftEditor";
import { redo, setDraftStatus } from "@/app/actions";

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const d = await getDraft(Number((await params).id));
  if (!d) notFound();
  const notes = await getNotes(d.note_ids);
  const busy = d.status === "running" || d.status === "queued";

  return (
    <>
      <AutoRefresh active={busy} />
      <div className="row spread">
        <h1>Draft #{d.id}</h1>
        <div className="row">
          <span className={`pill ${STATUS_TONE[d.status] ?? ""}`}>{d.status}</span>
          {d.pillar && <span className="pill">{d.pillar}</span>}
        </div>
      </div>
      {d.angle && <p className="sub">{d.angle}</p>}

      {busy && (
        <div className="card">
          <strong>Working: {d.stage ?? "queued"}</strong>
          <div className="small muted">Takes 2-4 minutes. This page refreshes on its own, and the draft will also arrive in Telegram.</div>
        </div>
      )}
      {d.status === "failed" && <div className="card notice">Failed: {d.error}</div>}

      <div className="two-col">
        <div>
          {d.body && !busy && <DraftEditor key={d.updated_at} id={d.id} initial={d.edited_body ?? d.body} status={d.status} />}

          <div className="card stack" style={{ marginTop: 12 }}>
            <strong>Redo</strong>
            <form action={redo} className="stack">
              <input type="hidden" name="id" value={d.id} />
              <textarea name="instruction" rows={2} placeholder="Optional: what to change - e.g. 'lead with the batch story', 'drop the news angle'" defaultValue="" />
              <div className="row">
                <button disabled={busy}>Redraft</button>
                {d.status !== "rejected" && (
                  <button formAction={setDraftStatus} name="status" value="rejected" disabled={busy}>Skip this one</button>
                )}
              </div>
            </form>
          </div>
        </div>

        <div>
          {d.qa && (
            <div className="card">
              <div className="row spread">
                <strong>Voice check</strong>
                <span className={`pill ${d.qa.pass ? "good" : "warn"}`}>{d.qa.score}/10</span>
              </div>
              <ul className="checks small" style={{ marginTop: 8 }}>
                {d.qa.checks.map((c) => (
                  <li key={c.id}>
                    <span className={`mark ${c.pass ? "ok" : "no"}`}>{c.pass ? "✓" : "✗"}</span>
                    <div><div>{c.name}</div>{!c.pass && <div className="muted">{c.detail}</div>}</div>
                  </li>
                ))}
              </ul>
              {(d.qa.flags.length > 0 || (d.qa.judgeNotes?.length ?? 0) > 0) && (
                <div className="small" style={{ marginTop: 8 }}>
                  {[...d.qa.flags, ...(d.qa.judgeNotes ?? [])].map((f, i) => <div key={i} className="muted">- {f}</div>)}
                </div>
              )}
              <div className="small muted" style={{ marginTop: 8 }}>Checks the generated draft, not your edits. {d.attempts} attempt(s).</div>
            </div>
          )}

          <div className="card small">
            <strong>News angle</strong>
            {d.news ? (
              <div className="stack" style={{ marginTop: 6 }}>
                <a href={d.news.url} target="_blank" rel="noreferrer">{d.news.headline}</a>
                <div className="muted">{d.news.publisher}{d.news.published ? ` · ${d.news.published}` : ""}</div>
                <div>{d.news.summary}</div>
              </div>
            ) : (
              <div className="muted" style={{ marginTop: 6 }}>{busy ? "Searching..." : "Nothing current fitted this note, so the post stands on the note alone."}</div>
            )}
          </div>

          {d.facts_used && d.facts_used.length > 0 && (
            <div className="card small">
              <strong>Facts used</strong>
              {d.facts_used.map((f, i) => (
                <div key={i} style={{ marginTop: 6 }}><span className="pill">{f.source.replace("_", " ")}</span> {f.text}</div>
              ))}
            </div>
          )}

          <div className="card small">
            <strong>From your notes</strong>
            {notes.map((n) => (
              <div key={n.id} style={{ marginTop: 10 }}>
                <div className="muted">#{n.id} · {n.source.replace("_", " ")} · {when(n.captured_at)}</div>
                <div className="note-text">{n.text}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
