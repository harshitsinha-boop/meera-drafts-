import { LoginForm } from "@/components/LoginForm";

export default function Login() {
  return (
    <div className="login">
      <h1>Draft Desk</h1>
      <p className="sub">Notes in, drafts out. Nothing posts without you.</p>
      <LoginForm />
    </div>
  );
}
