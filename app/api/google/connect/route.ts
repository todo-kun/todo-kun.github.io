import { NextResponse } from "next/server";
import { createGoogleAuthState, getGoogleAuthUrl, hasGoogleOAuthConfig } from "@/lib/google";

export async function GET() {
  if (!(await hasGoogleOAuthConfig())) {
    return NextResponse.json(
      {
        ok: false,
        error: "Google OAuth is not configured."
      },
      { status: 503 }
    );
  }

  const state = createGoogleAuthState();
  const response = NextResponse.redirect(await getGoogleAuthUrl(state));

  response.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10
  });

  return response;
}
