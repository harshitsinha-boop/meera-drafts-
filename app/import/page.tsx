import { ActionForm } from "@/components/ActionForm";
import { importTelegramExport, importDrafts } from "@/app/actions";

export default function Import() {
  return (
    <>
      <h1>Import the backlog</h1>
      <p className="sub">
        The bot only sees channel messages posted after it joins. Bring in the older notes and the abandoned drafts
        once, here. Re-importing the same files is safe because duplicates are skipped.
      </p>

      <h2>Telegram channel history</h2>
      <div className="card stack">
        <ol className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Open Telegram Desktop (the phone app can&apos;t export).</li>
          <li>Open the notes channel, then ⋮ menu → Export chat history.</li>
          <li>Untick photos and videos, set Format to &ldquo;Machine-readable JSON&rdquo;, and export.</li>
          <li>Upload the <code>result.json</code> file from the export folder.</li>
        </ol>
        <ActionForm action={importTelegramExport} submit="Import notes">
          <input type="file" name="file" accept=".json,application/json" required />
        </ActionForm>
      </div>

      <h2>Abandoned drafts from Google Drive</h2>
      <div className="card stack">
        <p className="small muted" style={{ margin: 0 }}>
          In Drive, select the drafts folder → Download. Unzip it and upload the .docx files (.txt and .md work too).
          Or paste drafts below, separated by a line containing only <code>---</code>.
        </p>
        <ActionForm action={importDrafts} submit="Import drafts">
          <input type="file" name="files" multiple accept=".docx,.txt,.md" />
          <textarea name="pasted" rows={6} placeholder="Or paste drafts here..." />
        </ActionForm>
      </div>
    </>
  );
}
