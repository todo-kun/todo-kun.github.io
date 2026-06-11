import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getAppConfig } from "@/lib/app-config";
import { decryptJson, encryptJson } from "@/lib/crypto";
import type { SyncState, TaskInput, TaskRecord } from "@/types/task";

const googleScopes = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/tasks",
  "openid",
  "email",
  "profile"
];

const sessionCookieName = "google_session";

export type GoogleTokens = {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string | null;
  token_type?: string | null;
};

type SyncResult = {
  status: SyncState;
  externalId: string | null;
  message: string;
};

export async function hasGoogleOAuthConfig() {
  const config = await getAppConfig();

  return Boolean(
    config.googleClientId &&
      config.googleClientSecret &&
      config.googleRedirectUri &&
      config.appSecret
  );
}

async function createOAuthClient() {
  const config = await getAppConfig();

  if (!config.googleClientId || !config.googleClientSecret || !config.googleRedirectUri) {
    throw new Error("Google OAuth settings are missing.");
  }

  return new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri
  );
}

export async function getBaseUrl() {
  const config = await getAppConfig();
  return config.appUrl || "http://localhost:3000";
}

export function createGoogleAuthState() {
  return randomUUID();
}

export async function getGoogleAuthUrl(state: string) {
  const client = await createOAuthClient();

  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: googleScopes,
    state
  });
}

export async function exchangeGoogleCode(code: string) {
  const oauth2Client = await createOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);

  return tokens satisfies GoogleTokens;
}

export async function storeGoogleSession(response: NextResponse, tokens: GoogleTokens) {
  const config = await getAppConfig();

  response.cookies.set(sessionCookieName, encryptJson(tokens, config.appSecret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
}

export function clearGoogleSession(response: NextResponse) {
  response.cookies.set(sessionCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

export async function getGoogleSession() {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(sessionCookieName)?.value;

  if (!cookie) {
    return null;
  }

  try {
    const config = await getAppConfig();
    return decryptJson<GoogleTokens>(cookie, config.appSecret);
  } catch {
    return null;
  }
}

async function buildAuthorizedClient(tokens: GoogleTokens) {
  const oauth2Client = await createOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokens.access_token ?? undefined,
    refresh_token: tokens.refresh_token ?? undefined,
    expiry_date: tokens.expiry_date ?? undefined,
    scope: tokens.scope ?? undefined,
    token_type: tokens.token_type ?? undefined
  });
  return oauth2Client;
}

export async function syncTaskToGoogle(
  input: TaskInput,
  session: GoogleTokens | null
): Promise<{ calendar: SyncResult; tasks: SyncResult }> {
  if (!(await hasGoogleOAuthConfig())) {
    return {
      calendar: {
        status: "missing_config",
        externalId: null,
        message: "Google settings are incomplete."
      },
      tasks: {
        status: "missing_config",
        externalId: null,
        message: "Google settings are incomplete."
      }
    };
  }

  if (!session?.access_token && !session?.refresh_token) {
    return {
      calendar: {
        status: "not_connected",
        externalId: null,
        message: "Connect your Google account first."
      },
      tasks: {
        status: "not_connected",
        externalId: null,
        message: "Connect your Google account first."
      }
    };
  }

  try {
    const auth = await buildAuthorizedClient(session);
    const config = await getAppConfig();
    const calendar = google.calendar({ version: "v3", auth });
    const tasks = google.tasks({ version: "v1", auth });
    const startDate = input.dueDate ? new Date(input.dueDate) : new Date();
    const endDate = input.dueDate
      ? new Date(new Date(input.dueDate).getTime() + 60 * 60 * 1000)
      : new Date(startDate.getTime() + 60 * 60 * 1000);

    const [calendarResponse, tasksResponse] = await Promise.all([
      calendar.events.insert({
        calendarId: config.googleCalendarId || "primary",
        requestBody: {
          summary: input.title,
          description: input.notes,
          start: {
            dateTime: startDate.toISOString()
          },
          end: {
            dateTime: endDate.toISOString()
          }
        }
      }),
      tasks.tasks.insert({
        tasklist: config.googleTasksListId || "@default",
        requestBody: {
          title: input.title,
          notes: input.notes,
          due: input.dueDate ? new Date(input.dueDate).toISOString() : undefined
        }
      })
    ]);

    return {
      calendar: {
        status: "synced",
        externalId: calendarResponse.data.id ?? null,
        message: "Calendar synced successfully."
      },
      tasks: {
        status: "synced",
        externalId: tasksResponse.data.id ?? null,
        message: "Google Tasks synced successfully."
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error.";
    return {
      calendar: { status: "failed", externalId: null, message },
      tasks: { status: "failed", externalId: null, message }
    };
  }
}

export async function syncStoredTaskToGoogle(
  task: TaskRecord,
  session: GoogleTokens | null
): Promise<{ calendar: SyncResult; tasks: SyncResult }> {
  if (!(await hasGoogleOAuthConfig())) {
    return {
      calendar: {
        status: "missing_config",
        externalId: task.calendarEventId,
        message: "Google settings are incomplete."
      },
      tasks: {
        status: "missing_config",
        externalId: task.googleTaskId,
        message: "Google settings are incomplete."
      }
    };
  }

  if (!session?.access_token && !session?.refresh_token) {
    return {
      calendar: {
        status: "not_connected",
        externalId: task.calendarEventId,
        message: "Connect your Google account first."
      },
      tasks: {
        status: "not_connected",
        externalId: task.googleTaskId,
        message: "Connect your Google account first."
      }
    };
  }

  try {
    const auth = await buildAuthorizedClient(session);
    const config = await getAppConfig();
    const calendar = google.calendar({ version: "v3", auth });
    const tasks = google.tasks({ version: "v1", auth });
    const startDate = task.dueDate ? new Date(task.dueDate) : new Date();
    const endDate = task.dueDate
      ? new Date(new Date(task.dueDate).getTime() + 60 * 60 * 1000)
      : new Date(startDate.getTime() + 60 * 60 * 1000);
    const taskStatus = task.completed ? "completed" : "needsAction";

    const calendarResponse = task.calendarEventId
      ? await calendar.events.update({
          calendarId: config.googleCalendarId || "primary",
          eventId: task.calendarEventId,
          requestBody: {
            summary: task.title,
            description: task.notes,
            start: { dateTime: startDate.toISOString() },
            end: { dateTime: endDate.toISOString() }
          }
        })
      : await calendar.events.insert({
          calendarId: config.googleCalendarId || "primary",
          requestBody: {
            summary: task.title,
            description: task.notes,
            start: { dateTime: startDate.toISOString() },
            end: { dateTime: endDate.toISOString() }
          }
        });

    const tasksResponse = task.googleTaskId
      ? await tasks.tasks.update({
          tasklist: config.googleTasksListId || "@default",
          task: task.googleTaskId,
          requestBody: {
            title: task.title,
            notes: task.notes,
            due: task.dueDate ? new Date(task.dueDate).toISOString() : undefined,
            status: taskStatus
          }
        })
      : await tasks.tasks.insert({
          tasklist: config.googleTasksListId || "@default",
          requestBody: {
            title: task.title,
            notes: task.notes,
            due: task.dueDate ? new Date(task.dueDate).toISOString() : undefined,
            status: taskStatus
          }
        });

    return {
      calendar: {
        status: "synced",
        externalId: calendarResponse.data.id ?? task.calendarEventId ?? null,
        message: "Calendar synced successfully."
      },
      tasks: {
        status: "synced",
        externalId: tasksResponse.data.id ?? task.googleTaskId ?? null,
        message: "Google Tasks synced successfully."
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error.";
    return {
      calendar: {
        status: "failed",
        externalId: task.calendarEventId,
        message
      },
      tasks: {
        status: "failed",
        externalId: task.googleTaskId,
        message
      }
    };
  }
}

export async function deleteTaskFromGoogle(task: TaskRecord, session: GoogleTokens | null) {
  if (!(await hasGoogleOAuthConfig())) {
    return;
  }

  if (!session?.access_token && !session?.refresh_token) {
    return;
  }

  const auth = await buildAuthorizedClient(session);
  const config = await getAppConfig();
  const calendar = google.calendar({ version: "v3", auth });
  const tasks = google.tasks({ version: "v1", auth });

  await Promise.allSettled([
    task.calendarEventId
      ? calendar.events.delete({
          calendarId: config.googleCalendarId || "primary",
          eventId: task.calendarEventId
        })
      : Promise.resolve(),
    task.googleTaskId
      ? tasks.tasks.delete({
          tasklist: config.googleTasksListId || "@default",
          task: task.googleTaskId
        })
      : Promise.resolve()
  ]);
}
