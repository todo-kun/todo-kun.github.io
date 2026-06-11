import { NextResponse } from "next/server";
import { getGoogleSession } from "@/lib/google";
import { exportTasksBackup, importTasksBackup, type TaskBackup } from "@/lib/tasks";

function isTaskBackup(value: unknown): value is TaskBackup {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<TaskBackup>;
  return candidate.version === 1 && Array.isArray(candidate.tasks);
}

export async function GET() {
  const session = await getGoogleSession();
  const backup = await exportTasksBackup(session);

  return NextResponse.json({
    ok: true,
    backup
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!isTaskBackup(body)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid backup file."
        },
        { status: 400 }
      );
    }

    const session = await getGoogleSession();
    const tasks = await importTasksBackup(body, session);

    return NextResponse.json({
      ok: true,
      tasks
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Backup import failed."
      },
      { status: 409 }
    );
  }
}
