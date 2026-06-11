import { NextResponse } from "next/server";
import { getAppConfigHealth } from "@/lib/app-config";

export async function GET() {
  const health = await getAppConfigHealth();

  return NextResponse.json({
    ok: true,
    health
  });
}
