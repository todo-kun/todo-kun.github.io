import { NextResponse } from "next/server";
import { getGoogleSession } from "@/lib/google";
import { retryFailedTaskSyncs } from "@/lib/tasks";

export async function POST() {
  try {
    const session = await getGoogleSession();
    const tasks = await retryFailedTaskSyncs(session);

    return NextResponse.json({
      ok: true,
      tasks
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Bulk sync could not be completed."
      },
      { status: 409 }
    );
  }
}
