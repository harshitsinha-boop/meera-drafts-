"use client";
import { useActionState } from "react";
import { login } from "@/app/actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="card stack">
      <div>
        <label htmlFor="pw">Password</label>
        <input id="pw" type="password" name="password" autoFocus required />
      </div>
      {state?.error && <div className="notice small">{state.error}</div>}
      <button className="primary" disabled={pending}>Sign in</button>
    </form>
  );
}
