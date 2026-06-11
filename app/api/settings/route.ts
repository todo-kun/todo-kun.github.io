import { NextResponse } from "next/server";
import { getPublicAppConfig, saveAppConfig } from "@/lib/app-config";

export async function GET() {
  const config = await getPublicAppConfig();

  return NextResponse.json({
    ok: true,
    config
  });
}

export async function PUT(request: Request) {
  const body = (await request.json()) as {
    googleClientId?: string;
    googleClientSecret?: string;
    googleRedirectUri?: string;
    googleCalendarId?: string;
    googleTasksListId?: string;
    appUrl?: string;
    appSecret?: string;
  };

  const config = await saveAppConfig({
    googleClientId: body.googleClientId?.trim(),
    googleClientSecret: body.googleClientSecret?.trim(),
    googleRedirectUri: body.googleRedirectUri?.trim(),
    googleCalendarId: body.googleCalendarId?.trim(),
    googleTasksListId: body.googleTasksListId?.trim(),
    appUrl: body.appUrl?.trim(),
    appSecret: body.appSecret?.trim()
  });

  return NextResponse.json({
    ok: true,
    config
  });
}
