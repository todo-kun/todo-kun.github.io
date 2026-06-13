import { NextResponse } from "next/server";
import { getGoogleSession } from "@/lib/google";
import { createTaskFromVoiceTranscript } from "@/lib/voice-task";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { transcript?: unknown } | null;
    const transcript = typeof body?.transcript === "string" ? body.transcript.trim() : "";

    if (!transcript) {
      return NextResponse.json(
        {
          ok: false,
          error: "Voice text is empty."
        },
        { status: 400 }
      );
    }

    const session = await getGoogleSession();
    const result = await createTaskFromVoiceTranscript(transcript, session);

    return NextResponse.json({
      ok: true,
      task: result.task,
      transcript: result.transcript,
      extracted: result.extracted
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Voice task could not be created."
      },
      { status: 409 }
    );
  }
}
