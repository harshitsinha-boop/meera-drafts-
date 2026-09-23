import { connection } from "next/server";
import { db, type Note } from "@/lib/db";
import { when } from "@/lib/format";
import { addNote, setNoteStatus, draftSelected } from "@/app/actions";

const FILTERS = ["new", "parked", "used", "skipped"] as const;

export default async function Notes({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await connection();
  const status = (FILTERS as readonly string[]).includes((await searchParams).status ?? "") ? (await searchParams).status! : "new";
  const sql = await db();
  const notes = (await sql`
    SELECT * FROM notes WHERE status = ${status}
    ORDER BY score DESC NULLS LAST, captured_at DESC LIMIT 300`) as Note[];
  const counts = Object.fromEntries(
    ((await sql`SELECT status, count(*)::int AS n FROM notes GROUP BY status`) as { status: string; n: number }[])
      .map((r) => [r.status, r.n]),
  );

  return (
    <>
      <h1>Notes</h1>
      <p className="sub">Everything captured from Telegram and your old drafts. Scores come from the last triage.</p>

      <form action={addNote} className="card stack">
        <textarea name="text" rows={3} placeholder="Add a note by hand..." required />
        <div><button>Add note</button></div>
      </form>

      <div className="row" style={{ margin: "16px 0" }}>
        {FILTERS.map((f) => (
          <a key={f} href={`/notes?status=${f}`} className={`pill ${f === status ? "good" : ""}`}>
            {f} ({counts[f] ?? 0})
          </a>
        ))}
      </div>

      {(status === "new" || status === "parked") && notes.length > 0 && (
        <form id="draft-form" action={draftSelected} className="card row">
          <input name="instruction" placeholder="Optional instruction for the draft" style={{ flex: 1, minWidth: 200 }} />
          <button className="primary">Draft from ticked notes</button>
        </form>
      )}
      {notes.length === 0 && <p className="muted">Nothing here.</p>}
      {notes.map((n) => (
        <div key={n.id} className="card">
          <div className="row spread">
            <label className="row" style={{ margin: 0, color: "inherit" }}>
              {(status === "new" || status === "parked") && (
                <input type="checkbox" name="note" value={n.id} form="draft-form" style={{ width: "auto" }} />
              )}
              <strong>#{n.id}</strong>
              <span className="pill">{n.source.replace("_", " ")}</span>
              {n.score != null && (
                <span className={`pill ${n.score >= 4 ? "good" : n.score <= 2 ? "" : "warn"}`}>{n.score}/5 {n.verdict}</span>
              )}
            </label>
            <span className="small muted">{when(n.captured_at)}</span>
          </div>
          <div className="note-text" style={{ marginTop: 8 }}>{n.text}</div>
          {n.triage_reason && <div className="small muted" style={{ marginTop: 6 }}>{n.triage_reason}</div>}
          {status !== "used" && (
            <form action={setNoteStatus} className="row" style={{ marginTop: 8 }}>
              <input type="hidden" name="id" value={n.id} />
              {status !== "new" && <button name="status" value="new">Back to new</button>}
              {status !== "parked" && <button name="status" value="parked">Park</button>}
              {status !== "skipped" && <button name="status" value="skipped">Not a post</button>}
            </form>
          )}
        </div>
      ))}
    </>
  );
}
