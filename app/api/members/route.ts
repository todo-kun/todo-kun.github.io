import { NextResponse } from "next/server";
import { listRegisteredMembers, upsertRegisteredMember } from "@/lib/members";
import { memberDirectoryEntrySchema } from "@/types/task";

export async function GET() {
  const members = await listRegisteredMembers();

  return NextResponse.json({
    ok: true,
    members
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = memberDirectoryEntrySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "Please review the member details."
        },
        { status: 400 }
      );
    }

    const members = await upsertRegisteredMember({
      name: parsed.data.name,
      email: parsed.data.email,
      projectNames: parsed.data.projectNames ?? []
    });

    return NextResponse.json({
      ok: true,
      members
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Members could not be saved."
      },
      { status: 409 }
    );
  }
}
