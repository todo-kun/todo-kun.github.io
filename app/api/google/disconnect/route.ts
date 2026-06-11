import { NextResponse } from "next/server";
import { clearGoogleSession } from "@/lib/google";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearGoogleSession(response);
  return response;
}
