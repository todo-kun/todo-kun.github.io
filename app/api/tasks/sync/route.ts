import { NextResponse } from "next/server";
import { getGoogleSession } from "@/lib/google";
import { retryFailedTaskSyncs } from "@/lib/tasks";

export async function POST() {
  const session = await getGoogleSession();
  const tasks = await retryFailedTaskSyncs(session);

  return NextResponse.json({
    ok: true,
    tasks
  });
}
