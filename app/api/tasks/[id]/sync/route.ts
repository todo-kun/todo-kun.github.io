import { NextResponse } from "next/server";
import { getGoogleSession } from "@/lib/google";
import { retryTaskSync } from "@/lib/tasks";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const session = await getGoogleSession();
  const task = await retryTaskSync(id, session);

  if (!task) {
    return NextResponse.json({ ok: false, error: "Task not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, task });
}
