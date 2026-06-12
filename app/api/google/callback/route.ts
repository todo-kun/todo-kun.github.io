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

  const oauthError = request.nextUrl.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/?google=oauth-error&reason=${encodeURIComponent(oauthError)}`, await getBaseUrl())
    );
  }

  const cookieStore = await cookies();
  const stateFromCookie = cookieStore.get("gos")?.value;
  const stateFromQuery = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");

  if (!code || !stateFromCookie || !stateFromQuery || stateFromCookie !== stateFromQuery) {
    return NextResponse.redirect(new URL("/?google=invalid-state", await getBaseUrl()));
  }

  try {
    const tokens = await exchangeGoogleCode(code);
    const response = NextResponse.redirect(new URL("/?google=connected", await getBaseUrl()));

    response.cookies.set("gos", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0
    });

    await storeGoogleSession(response, tokens);

    return response;
  } catch {
    return NextResponse.redirect(new URL("/?google=token-error", await getBaseUrl()));
  }
}
