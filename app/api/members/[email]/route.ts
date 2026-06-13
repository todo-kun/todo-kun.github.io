import { NextResponse } from "next/server";
import { deleteRegisteredMember, updateRegisteredMember } from "@/lib/members";
import { z } from "zod";

const memberUpdateSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80),
  projectNames: z.array(z.string().trim().min(1).max(80)).max(20).optional()
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ email: string }> }
) {
  try {
    const body = await request.json();
    const parsed = memberUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "Please review the member details."
        },
        { status: 400 }
      );
    }

    const { email } = await params;
    const members = await updateRegisteredMember(decodeURIComponent(email), {
      name: parsed.data.name,
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
        error: error instanceof Error ? error.message : "Member could not be updated."
      },
      { status: 409 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ email: string }> }
) {
  try {
    const { email } = await params;
    const members = await deleteRegisteredMember(decodeURIComponent(email));

    return NextResponse.json({
      ok: true,
      members
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Member could not be deleted."
      },
      { status: 409 }
    );
  }
}
