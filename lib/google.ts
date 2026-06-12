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

function compactGoogleTokens(tokens: GoogleTokens): GoogleTokens {
  if (tokens.refresh_token) {
    return {
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token ?? null,
      expiry_date: tokens.expiry_date ?? null
    };
  }

  return {
    access_token: tokens.access_token ?? null,
    refresh_token: null,
    expiry_date: tokens.expiry_date ?? null
  };
}

type SyncResult = {
  status: SyncState;
  externalId: string | null;
  message: string;
};

type ManagedTaskMetadata = {
  version: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  calendarEventId: string | null;
  lastSyncAttemptedAt: string | null;
};

const taskMetadataMarker = "[TODOKUN_META]";

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
  const compactTokens = compactGoogleTokens(tokens);

  response.cookies.set(sessionCookieName, encryptJson(compactTokens, config.appSecret), {
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

function buildManagedTaskMetadata(task: Pick<
  TaskRecord,
  "id" | "createdAt" | "updatedAt" | "calendarEventId" | "lastSyncAttemptedAt"
>): ManagedTaskMetadata {
  return {
    version: 1,
    id: task.id,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    calendarEventId: task.calendarEventId,
    lastSyncAttemptedAt: task.lastSyncAttemptedAt
  };
}

export function encodeManagedTaskNotes(
  notes: string,
  task: Pick<TaskRecord, "id" | "createdAt" | "updatedAt" | "calendarEventId" | "lastSyncAttemptedAt">
) {
  const cleanNotes = notes.trimEnd();
  const metadata = Buffer.from(JSON.stringify(buildManagedTaskMetadata(task))).toString("base64url");

  return [cleanNotes, `${taskMetadataMarker}${metadata}`].filter(Boolean).join("\n\n");
}

export function parseManagedTaskNotes(rawNotes: string | null | undefined) {
  if (!rawNotes) {
    return {
      notes: "",
      metadata: null as ManagedTaskMetadata | null
    };
  }

  const markerIndex = rawNotes.lastIndexOf(taskMetadataMarker);

  if (markerIndex === -1) {
    return {
      notes: rawNotes,
      metadata: null as ManagedTaskMetadata | null
    };
  }

  const notes = rawNotes.slice(0, markerIndex).trimEnd();
  const encoded = rawNotes.slice(markerIndex + taskMetadataMarker.length).trim();

  try {
    const metadata = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ManagedTaskMetadata;
    return { notes, metadata };
  } catch {
    return { notes: rawNotes, metadata: null as ManagedTaskMetadata | null };
  }
}

export async function listGoogleBackedTasks(session: GoogleTokens | null): Promise<TaskRecord[]> {
  if (!(await hasGoogleOAuthConfig())) {
    return [];
  }

  if (!session?.access_token && !session?.refresh_token) {
    return [];
  }

  const auth = await buildAuthorizedClient(session);
  const config = await getAppConfig();
  const tasksApi = google.tasks({ version: "v1", auth });
  const collected: TaskRecord[] = [];
  let pageToken: string | undefined;

  do {
    const response = await tasksApi.tasks.list({
      tasklist: config.googleTasksListId || "@default",
      maxResults: 100,
      showCompleted: true,
      showHidden: true,
      pageToken
    });

    for (const item of response.data.items ?? []) {
      const { notes, metadata } = parseManagedTaskNotes(item.notes);

      if (!metadata) {
        continue;
      }

      collected.push({
        id: metadata.id,
        title: item.title ?? "Untitled task",
        dueDate: item.due ?? null,
        notes,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt ?? item.updated ?? metadata.createdAt,
        completed: item.status === "completed",
        calendarSync: metadata.calendarEventId ? "synced" : "failed",
        tasksSync: item.id ? "synced" : "failed",
        calendarSyncMessage: metadata.calendarEventId
          ? "Calendar synced successfully."
          : "Calendar sync needs attention.",
        tasksSyncMessage: item.id
          ? "Google Tasks synced successfully."
          : "Google Tasks sync needs attention.",
        lastSyncAttemptedAt: metadata.lastSyncAttemptedAt,
        calendarEventId: metadata.calendarEventId,
        googleTaskId: item.id ?? null
      });
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return collected.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createGoogleBackedTask(
  input: TaskInput,
  session: GoogleTokens | null,
  seed?: Partial<Pick<TaskRecord, "id" | "createdAt">> & { completed?: boolean }
) {
  if (!(await hasGoogleOAuthConfig())) {
    throw new Error("Google settings are incomplete. Save the production settings first.");
  }

  if (!session?.access_token && !session?.refresh_token) {
    throw new Error("Google connection is required for the current task storage mode.");
  }

  const auth = await buildAuthorizedClient(session);
  const config = await getAppConfig();
  const calendar = google.calendar({ version: "v3", auth });
  const tasksApi = google.tasks({ version: "v1", auth });
  const timestamp = new Date().toISOString();
  const record: TaskRecord = {
    id: seed?.id ?? randomUUID(),
    title: input.title,
    dueDate: input.dueDate || null,
    notes: input.notes ?? "",
    createdAt: seed?.createdAt ?? timestamp,
    updatedAt: timestamp,
    completed: seed?.completed ?? false,
    calendarSync: "failed",
    tasksSync: "failed",
    calendarSyncMessage: "Calendar sync has not started yet.",
    tasksSyncMessage: "Google Tasks sync has not started yet.",
    lastSyncAttemptedAt: timestamp,
    calendarEventId: null,
    googleTaskId: null
  };

  const insertedTask = await tasksApi.tasks.insert({
    tasklist: config.googleTasksListId || "@default",
    requestBody: {
      title: record.title,
      notes: encodeManagedTaskNotes(record.notes, record),
      due: record.dueDate ? new Date(record.dueDate).toISOString() : undefined,
      status: record.completed ? "completed" : "needsAction"
    }
  });

  record.googleTaskId = insertedTask.data.id ?? null;
  record.tasksSync = record.googleTaskId ? "synced" : "failed";
  record.tasksSyncMessage = record.googleTaskId
    ? "Google Tasks synced successfully."
    : "Google Tasks sync failed.";

  try {
    const startDate = record.dueDate ? new Date(record.dueDate) : new Date();
    const endDate = record.dueDate
      ? new Date(new Date(record.dueDate).getTime() + 60 * 60 * 1000)
      : new Date(startDate.getTime() + 60 * 60 * 1000);

    const calendarResponse = await calendar.events.insert({
      calendarId: config.googleCalendarId || "primary",
      requestBody: {
        summary: record.title,
        description: record.notes,
        start: { dateTime: startDate.toISOString() },
        end: { dateTime: endDate.toISOString() }
      }
    });

    record.calendarEventId = calendarResponse.data.id ?? null;
    record.calendarSync = "synced";
    record.calendarSyncMessage = "Calendar synced successfully.";
  } catch (error) {
    record.calendarSync = "failed";
    record.calendarSyncMessage =
      error instanceof Error ? error.message : "Calendar sync failed.";
  }

  if (record.googleTaskId) {
    const googleTaskId = record.googleTaskId;
    await tasksApi.tasks.update({
      tasklist: config.googleTasksListId || "@default",
      task: googleTaskId,
      requestBody: {
        title: record.title,
        notes: encodeManagedTaskNotes(record.notes, record),
        due: record.dueDate ? new Date(record.dueDate).toISOString() : undefined,
        status: record.completed ? "completed" : "needsAction"
      }
    });
  }

  return record;
}

export async function syncGoogleBackedTask(task: TaskRecord, session: GoogleTokens | null) {
  if (!(await hasGoogleOAuthConfig())) {
    throw new Error("Google settings are incomplete. Save the production settings first.");
  }

  if (!session?.access_token && !session?.refresh_token) {
    throw new Error("Google connection is required for the current task storage mode.");
  }

  if (!task.googleTaskId) {
    throw new Error("The Google-backed task is missing its Google Tasks ID.");
  }

  const googleTaskId = task.googleTaskId;

  const auth = await buildAuthorizedClient(session);
  const config = await getAppConfig();
  const calendar = google.calendar({ version: "v3", auth });
  const tasksApi = google.tasks({ version: "v1", auth });
  const nextTask: TaskRecord = {
    ...task,
    updatedAt: new Date().toISOString(),
    lastSyncAttemptedAt: new Date().toISOString()
  };

  try {
    const startDate = nextTask.dueDate ? new Date(nextTask.dueDate) : new Date();
    const endDate = nextTask.dueDate
      ? new Date(new Date(nextTask.dueDate).getTime() + 60 * 60 * 1000)
      : new Date(startDate.getTime() + 60 * 60 * 1000);

    const calendarResponse = nextTask.calendarEventId
      ? await calendar.events.update({
          calendarId: config.googleCalendarId || "primary",
          eventId: nextTask.calendarEventId,
          requestBody: {
            summary: nextTask.title,
            description: nextTask.notes,
            start: { dateTime: startDate.toISOString() },
            end: { dateTime: endDate.toISOString() }
          }
        })
      : await calendar.events.insert({
          calendarId: config.googleCalendarId || "primary",
          requestBody: {
            summary: nextTask.title,
            description: nextTask.notes,
            start: { dateTime: startDate.toISOString() },
            end: { dateTime: endDate.toISOString() }
          }
        });

    nextTask.calendarEventId = calendarResponse.data.id ?? nextTask.calendarEventId ?? null;
    nextTask.calendarSync = "synced";
    nextTask.calendarSyncMessage = "Calendar synced successfully.";
  } catch (error) {
    nextTask.calendarSync = "failed";
    nextTask.calendarSyncMessage =
      error instanceof Error ? error.message : "Calendar sync failed.";
  }

  const tasksResponse = await tasksApi.tasks.update({
    tasklist: config.googleTasksListId || "@default",
    task: googleTaskId,
    requestBody: {
      title: nextTask.title,
      notes: encodeManagedTaskNotes(nextTask.notes, nextTask),
      due: nextTask.dueDate ? new Date(nextTask.dueDate).toISOString() : undefined,
      status: nextTask.completed ? "completed" : "needsAction"
    }
  });

  nextTask.googleTaskId = tasksResponse.data.id ?? nextTask.googleTaskId;
  nextTask.tasksSync = "synced";
  nextTask.tasksSyncMessage = "Google Tasks synced successfully.";

  return nextTask;
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
