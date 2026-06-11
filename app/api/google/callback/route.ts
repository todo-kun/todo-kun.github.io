import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  exchangeGoogleCode,
  getBaseUrl,
  hasGoogleOAuthConfig,
  storeGoogleSession
} from "@/lib/google";

export async function GET(request: NextRequest) {
  if (!(await hasGoogleOAuthConfig())) {
    return NextResponse.redirect(new URL("/?google=missing-config", await getBaseUrl()));
  }

  const cookieStore = await cookies();
  const stateFromCookie = cookieStore.get("google_oauth_state")?.value;
  const stateFromQuery = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");

  if (!code || !stateFromCookie || !stateFromQuery || stateFromCookie !== stateFromQuery) {
    return NextResponse.redirect(new URL("/?google=invalid-state", await getBaseUrl()));
  }

  const tokens = await exchangeGoogleCode(code);
  const response = NextResponse.redirect(new URL("/?google=connected", await getBaseUrl()));

  response.cookies.set("google_oauth_state", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });

  await storeGoogleSession(response, tokens);

  return response;
}
