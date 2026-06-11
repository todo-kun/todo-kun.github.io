import { NextResponse } from "next/server";
import { getGoogleSession, hasGoogleOAuthConfig } from "@/lib/google";

export async function GET() {
  const session = await getGoogleSession();

  return NextResponse.json({
    ok: true,
    configured: await hasGoogleOAuthConfig(),
    connected: Boolean(session)
  });
}
