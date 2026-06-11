import { NextResponse } from "next/server";
import { attachAppConfigCookie, getPublicAppConfig, getAppConfig, saveAppConfig } from "@/lib/app-config";

export async function GET() {
  const config = await getPublicAppConfig();

  return NextResponse.json({
    ok: true,
    config
  });
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      googleClientId?: string;
      googleClientSecret?: string;
      googleRedirectUri?: string;
      googleCalendarId?: string;
      googleTasksListId?: string;
      appUrl?: string;
      appSecret?: string;
    };

    const saved = await saveAppConfig({
      googleClientId: body.googleClientId?.trim(),
      googleClientSecret: body.googleClientSecret?.trim(),
      googleRedirectUri: body.googleRedirectUri?.trim(),
      googleCalendarId: body.googleCalendarId?.trim(),
      googleTasksListId: body.googleTasksListId?.trim(),
      appUrl: body.appUrl?.trim(),
      appSecret: body.appSecret?.trim()
    });

    const response = NextResponse.json({
      ok: true,
      config: saved.config
    });
    attachAppConfigCookie(response, saved.fullConfig);
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Settings could not be saved."
      },
      { status: 409 }
    );
  }
}
