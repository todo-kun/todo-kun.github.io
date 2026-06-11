import { NextResponse } from "next/server";
import { getGoogleSession } from "@/lib/google";
import { deleteTask, updateTaskAndSync } from "@/lib/tasks";
import { taskUpdateSchema } from "@/types/task";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  const body = await request.json();
  const parsed = taskUpdateSchema.safeParse(body);

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

  const { id } = await context.params;
  const session = await getGoogleSession();
  const task = await updateTaskAndSync(id, parsed.data, session);

  if (!task) {
    return NextResponse.json({ ok: false, error: "Task not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, task });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const session = await getGoogleSession();
  const deleted = await deleteTask(id, session);

  if (!deleted) {
    return NextResponse.json({ ok: false, error: "Task not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
