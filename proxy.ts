import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const legacyCookieNames = [
  "todokun_app_config",
  "todokun_app_config_v2",
  "google_session",
  "google_session_v2",
  "google_oauth_state"
];

export function proxy(request: NextRequest) {
  const cookieNames = new Set(request.cookies.getAll().map((cookie) => cookie.name));
  const staleCookies = legacyCookieNames.filter((name) => cookieNames.has(name));

  if (staleCookies.length === 0) {
    return NextResponse.next();
  }

  const response = NextResponse.next();

  for (const name of staleCookies) {
    response.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
