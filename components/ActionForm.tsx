"use client";
import { useActionState } from "react";

type Result = { message: string } | null;

// Form bound to a server action that returns a status message.
export function ActionForm({
  action,
  children,
  submit,
}: {
  action: (prev: Result, form: FormData) => Promise<Result>;
  children?: React.ReactNode;
  submit: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="stack">
      {children}
      <div className="row">
        <button className="primary" disabled={pending}>{pending ? "Working..." : submit}</button>
        {state?.message && <span className="small muted">{state.message}</span>}
      </div>
    </form>
  );
}
