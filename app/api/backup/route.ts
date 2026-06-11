import { NextResponse } from "next/server";
import { exportTasksBackup, importTasksBackup, listTasks, type TaskBackup } from "@/lib/tasks";

function isTaskBackup(value: unknown): value is TaskBackup {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<TaskBackup>;
  return candidate.version === 1 && Array.isArray(candidate.tasks);
}

export async function GET() {
  const backup = await exportTasksBackup();

  return NextResponse.json({
    ok: true,
    backup
  });
}

export async function POST(request: Request) {
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

  const tasks = await importTasksBackup(body);

  return NextResponse.json({
    ok: true,
    tasks
  });
}
