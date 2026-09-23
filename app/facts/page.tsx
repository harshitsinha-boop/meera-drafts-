import { connection } from "next/server";
import { getFacts } from "@/lib/db";
import { addFact, updateFact } from "@/app/actions";

export default async function Facts() {
  await connection();
  const facts = await getFacts();
  return (
    <>
      <h1>Fact bank</h1>
      <p className="sub">
        The only numbers and Skinstinct details a draft may use, besides what&apos;s in your notes and a cited news item.
        Any other number in a draft fails the check. Clear a fact&apos;s text and save to delete it.
      </p>

      <div className="card notice small" style={{ marginBottom: 16 }}>
        Two things in the source material disagree and are left out until you confirm them: how long Skinstinct has been
        running (a founder story says &ldquo;three years later&rdquo; from 2021, a newsletter says &ldquo;18 months&rdquo;),
        and the humid-city return figures (&ldquo;almost three times&rdquo; vs 23% and 71%). Add the correct versions here.
      </div>

      <form action={addFact} className="card stack">
        <div>
          <label htmlFor="text">Fact</label>
          <textarea id="text" name="text" rows={2} required placeholder="e.g. Our Vitamin C serum is tested at pH 3.2 in every batch." />
        </div>
        <div>
          <label htmlFor="source">Where it comes from</label>
          <input id="source" name="source" placeholder="e.g. batch records, Q2 customer survey (n=412)" />
        </div>
        <div><button className="primary">Add fact</button></div>
      </form>

      <h2>{facts.length} facts</h2>
      {facts.map((f) => (
        <form key={f.id} action={updateFact} className="card stack">
          <input type="hidden" name="id" value={f.id} />
          <textarea name="text" rows={2} defaultValue={f.text} />
          <div className="row">
            <input name="source" defaultValue={f.source ?? ""} placeholder="Source" style={{ flex: 1, minWidth: 180 }} />
            <button>Save</button>
          </div>
        </form>
      ))}
    </>
  );
}
