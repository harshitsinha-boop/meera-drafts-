import Link from "next/link";
import { connection } from "next/server";
import { db, type Draft } from "@/lib/db";
import { when, STATUS_TONE } from "@/lib/format";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ActionForm } from "@/components/ActionForm";
import { runTriage, connectTelegram } from "./actions";

export default async function Home() {
  await connection();
  const sql = await db();
  const drafts = (await sql`SELECT * FROM drafts ORDER BY created_at DESC LIMIT 60`) as Draft[];
  const [counts] = (await sql`
    SELECT
      (SELECT count(*)::int FROM notes WHERE status = 'new') AS fresh,
      (SELECT count(*)::int FROM notes WHERE status = 'parked') AS parked,
      (SELECT count(*)::int FROM drafts WHERE status = 'posted' AND updated_at > now() - interval '7 days') AS posted_week`) as {
    fresh: number; parked: number; posted_week: number;
  }[];
  const active = drafts.some((d) => d.status === "running" || d.status === "queued");
  const waiting = drafts.filter((d) => d.status === "ready").length;
  const missing = ["GEMINI_API_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_OWNER_ID", "TELEGRAM_CHANNEL_ID", "CRON_SECRET"]
    .filter((k) => !process.env[k]);

  return (
    <>
      <AutoRefresh active={active} />
      <h1>Drafts</h1>
      <p className="sub">Drafts are made Mon, Wed and Fri mornings from your strongest notes. You edit and post them yourself.</p>

      {missing.length > 0 && (
        <div className="notice small" style={{ marginBottom: 16 }}>Not configured yet: {missing.join(", ")}. See the README.</div>
      )}

      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="card"><div className="stat">{waiting}</div><div className="small muted">waiting for you</div></div>
        <div className="card"><div className="stat">{counts.posted_week}<span className="muted" style={{ fontSize: 16 }}> / 3</span></div><div className="small muted">posted this week</div></div>
        <div className="card"><div className="stat">{counts.fresh}</div><div className="small muted">new notes</div></div>
        <div className="card"><div className="stat">{counts.parked}</div><div className="small muted">parked notes</div></div>
      </div>

      <div className="card row spread">
        <div>
          <strong>Draft now</strong>
          <div className="small muted">Reads every new and parked note and drafts the strongest.</div>
        </div>
        <form action={runTriage} className="row">
          <select name="count" defaultValue="1" style={{ width: "auto" }}>
            <option value="1">1 draft</option>
            <option value="2">2 drafts</option>
            <option value="3">3 drafts</option>
          </select>
          <button className="primary">Pick and draft</button>
        </form>
      </div>

      <h2>All drafts</h2>
      {drafts.length === 0 && <p className="muted">No drafts yet. Import your backlog, then press &ldquo;Pick and draft&rdquo;.</p>}
      {drafts.map((d) => (
        <Link key={d.id} href={`/drafts/${d.id}`} style={{ textDecoration: "none", color: "inherit" }}>
          <div className="card">
            <div className="row spread">
              <div className="row">
                <strong>#{d.id}</strong>
                <span className={`pill ${STATUS_TONE[d.status] ?? ""}`}>{d.status === "running" ? d.stage ?? "running" : d.status}</span>
                {d.pillar && <span className="pill">{d.pillar}</span>}
                {d.qa && <span className={`pill ${d.qa.pass ? "good" : "warn"}`}>QA {d.qa.score}/10</span>}
                {d.news && <span className="pill">news angle</span>}
              </div>
              <span className="small muted">{when(d.created_at)}</span>
            </div>
            <div style={{ marginTop: 8 }}>{d.angle ?? (d.body ?? "").slice(0, 160)}</div>
          </div>
        </Link>
      ))}

      <h2>Telegram</h2>
      <div className="card">
        <p className="small muted" style={{ marginTop: 0 }}>
          Run this once after deploying (and again if the domain changes). It points the bot at this deployment.
        </p>
        <ActionForm action={connectTelegram} submit="Connect webhook" />
      </div>
    </>
  );
}
