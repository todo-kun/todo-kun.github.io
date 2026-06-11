import { NextResponse } from "next/server";
import { getGoogleSession } from "@/lib/google";
import { createTaskAndSync, listTasks } from "@/lib/tasks";
import { taskInputSchema } from "@/types/task";

export async function GET() {
  const session = await getGoogleSession();
  const tasks = await listTasks(session);

  return NextResponse.json({
    ok: true,
    tasks
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = taskInputSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "Please review the task input.",
          details: parsed.error.flatten()
        },
        { status: 400 }
      );
    }

    const session = await getGoogleSession();
    const task = await createTaskAndSync(parsed.data, session);

    return NextResponse.json({
      ok: true,
      task
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Task could not be created."
      },
      { status: 409 }
    );
  }
}
