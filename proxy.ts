import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionToken, safeEqual } from "@/lib/auth";

export function proxy(req: NextRequest) {
  if (safeEqual(req.cookies.get(SESSION_COOKIE)?.value, sessionToken())) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

// Telegram, cron and the draft runner authenticate themselves with their own secrets.
export const config = {
  matcher: ["/((?!login|api/telegram|api/cron|api/drafts/.+/run|_next|favicon.ico).*)"],
};
