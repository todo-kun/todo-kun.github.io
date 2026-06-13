import { NextResponse } from "next/server";
import { addTaxonomyEntry, listTaxonomy } from "@/lib/taxonomy";
import { taxonomyEntrySchema } from "@/types/task";

export async function GET() {
  const taxonomy = await listTaxonomy();

  return NextResponse.json({
    ok: true,
    taxonomy
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = taxonomyEntrySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "Please review the name."
        },
        { status: 400 }
      );
    }

    const taxonomy = await addTaxonomyEntry(parsed.data.kind, parsed.data.name);

    return NextResponse.json({
      ok: true,
      taxonomy
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Taxonomy could not be saved."
      },
      { status: 409 }
    );
  }
}
