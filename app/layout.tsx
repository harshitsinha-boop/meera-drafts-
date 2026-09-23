import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, sessionToken, safeEqual } from "@/lib/auth";
import { logout } from "./actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "Draft Desk",
  description: "Turns Meera's Telegram notes into LinkedIn drafts she can edit and post.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const signedIn = safeEqual((await cookies()).get(SESSION_COOKIE)?.value, sessionToken());
  return (
    <html lang="en-GB">
      <body>
        {signedIn && (
          <header className="topbar">
            <Link href="/" className="brand">Draft Desk</Link>
            <nav>
              <Link href="/">Drafts</Link>
              <Link href="/notes">Notes</Link>
              <Link href="/facts">Fact bank</Link>
              <Link href="/import">Import</Link>
              <form action={logout}><button className="linklike">Sign out</button></form>
            </nav>
          </header>
        )}
        <main>{children}</main>
      </body>
    </html>
  );
}
