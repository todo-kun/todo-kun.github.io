import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { google } from "googleapis";
import type { tasks_v1 } from "googleapis";
import { getAppConfig } from "@/lib/app-config";
import { decryptJson, encryptJson } from "@/lib/crypto";
import type { SyncState, TaskInput, TaskRecord } from "@/types/task";

export const googleScopes = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/tasks",
  "openid",
  "email",
  "profile"
];

export const sessionCookieName = "gs3";
export const oauthStateCookieName = "gos";

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
      refresh_token: tokens.refresh_token
    };
  }

  return {
    access_token: tokens.access_token ?? null
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
  dueDate: string | null;
  projectName: string;
  categoryName: string;
  memberEmails: string[];
  createdAt: string;
  updatedAt: string;
  calendarEventId: string | null;
  lastSyncAttemptedAt: string | null;
  calendarSync: SyncState;
  calendarSyncMessage: string;
  tasksSync: SyncState;
  tasksSyncMessage: string;
};

const taskMetadataMarker = "[TODOKUN_META]";
const calendarTaskIdKey = "todokunTaskId";

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

export async function buildAuthorizedClient(tokens: GoogleTokens) {
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
  | "id"
  | "dueDate"
  | "projectName"
  | "categoryName"
  | "memberEmails"
  | "createdAt"
  | "updatedAt"
  | "calendarEventId"
  | "lastSyncAttemptedAt"
  | "calendarSync"
  | "calendarSyncMessage"
  | "tasksSync"
  | "tasksSyncMessage"
>): ManagedTaskMetadata {
  return {
    version: 1,
    id: task.id,
    dueDate: task.dueDate,
    projectName: task.projectName,
    categoryName: task.categoryName,
    memberEmails: task.memberEmails,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    calendarEventId: task.calendarEventId,
    lastSyncAttemptedAt: task.lastSyncAttemptedAt,
    calendarSync: task.calendarSync,
    calendarSyncMessage: task.calendarSyncMessage,
    tasksSync: task.tasksSync,
    tasksSyncMessage: task.tasksSyncMessage
  };
}

export function encodeManagedTaskNotes(
  notes: string,
  task: Pick<
    TaskRecord,
    | "id"
    | "dueDate"
    | "projectName"
    | "categoryName"
    | "memberEmails"
    | "createdAt"
    | "updatedAt"
    | "calendarEventId"
    | "lastSyncAttemptedAt"
    | "calendarSync"
    | "calendarSyncMessage"
    | "tasksSync"
    | "tasksSyncMessage"
  >
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

async function persistManagedTaskMetadata(
  tasksApi: tasks_v1.Tasks,
  tasklist: string,
  taskId: string,
  task: TaskRecord
) {
  if (!taskId) {
    throw new Error("Missing task ID");
  }

  await tasksApi.tasks.update({
    tasklist,
    task: taskId,
    requestBody: {
      title: task.title,
      notes: encodeManagedTaskNotes(task.notes, task),
      due: task.dueDate ? new Date(task.dueDate).toISOString() : undefined,
      status: task.completed ? "completed" : "needsAction"
    }
  });
}

async function persistManagedTaskMetadataSafely(
  tasksApi: tasks_v1.Tasks,
  tasklist: string,
  taskId: string | null,
  task: TaskRecord
) {
  if (!taskId) {
    return false;
  }

  try {
    await persistManagedTaskMetadata(tasksApi, tasklist, taskId, task);
    return true;
  } catch {
    return false;
  }
}

function buildCalendarEventRequestBody(
  task: Pick<TaskRecord, "id" | "title" | "notes" | "dueDate" | "memberEmails">
) {
  const startDate = task.dueDate ? new Date(task.dueDate) : new Date();
  const endDate = task.dueDate
    ? new Date(new Date(task.dueDate).getTime() + 60 * 60 * 1000)
    : new Date(startDate.getTime() + 60 * 60 * 1000);

  return {
    summary: task.title,
    description: task.notes,
    attendees: task.memberEmails.map((email) => ({ email })),
    start: { dateTime: startDate.toISOString() },
    end: { dateTime: endDate.toISOString() },
    extendedProperties: {
      private: {
        [calendarTaskIdKey]: task.id
      }
    }
  };
}

async function getCalendarEventById(
  calendar: ReturnType<typeof google.calendar>,
  calendarId: string,
  eventId: string
) {
  try {
    const response = await calendar.events.get({
      calendarId,
      eventId
    });

    return response.data;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 404
    ) {
      return null;
    }

    throw error;
  }
}

async function findMatchingCalendarEventId(
  calendar: ReturnType<typeof google.calendar>,
  calendarId: string,
  task: Pick<TaskRecord, "id" | "title" | "notes" | "dueDate">
) {
  const byPrivateProperty = await calendar.events
    .list({
      calendarId,
      privateExtendedProperty: [`${calendarTaskIdKey}=${task.id}`],
      singleEvents: true,
      maxResults: 1
    })
    .catch(() => null);

  const privateMatch = byPrivateProperty?.data.items?.[0]?.id;

  if (privateMatch) {
    return privateMatch;
  }

  const anchorDate = task.dueDate ? new Date(task.dueDate) : new Date();
  const timeMin = new Date(anchorDate.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(anchorDate.getTime() + 36 * 60 * 60 * 1000).toISOString();

  const response = await calendar.events.list({
    calendarId,
    q: task.title,
    singleEvents: true,
    timeMin,
    timeMax,
    maxResults: 20
  });

  const normalizedNotes = task.notes.trim();
  const matchingEvent = (response.data.items ?? []).find((item) => {
    if ((item.summary ?? "").trim() !== task.title.trim()) {
      return false;
    }

    if (normalizedNotes && (item.description ?? "").trim() !== normalizedNotes) {
      return false;
    }

    return true;
  });

  return matchingEvent?.id ?? null;
}

async function resolveCalendarEventId(
  calendar: ReturnType<typeof google.calendar>,
  calendarId: string,
  task: Pick<TaskRecord, "id" | "title" | "notes" | "dueDate">,
  preferredEventId: string | null
) {
  if (preferredEventId) {
    const existingEvent = await getCalendarEventById(calendar, calendarId, preferredEventId);

    if (existingEvent?.id) {
      return {
        eventId: existingEvent.id,
        deletedExternally: false
      };
    }

    return {
      eventId: null,
      deletedExternally: true
    };
  }

  return {
    eventId: await findMatchingCalendarEventId(calendar, calendarId, task).catch(() => null),
    deletedExternally: false
  };
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
  const calendar = google.calendar({ version: "v3", auth });
  const tasksApi = google.tasks({ version: "v1", auth });
  const calendarId = config.googleCalendarId || "primary";
  const tasklistId = config.googleTasksListId || "@default";
  const collected: TaskRecord[] = [];
  let pageToken: string | undefined;

  try {
    do {
      const response = await tasksApi.tasks.list({
        tasklist: tasklistId,
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

        const resolution = await resolveCalendarEventId(
          calendar,
          calendarId,
          {
            id: metadata.id,
            title: item.title ?? "Untitled task",
            notes,
            dueDate: metadata.dueDate ?? item.due ?? null
          },
          metadata.calendarEventId
        );

        if (item.id && resolution.deletedExternally) {
          await tasksApi.tasks
            .delete({
              tasklist: tasklistId,
              task: item.id
            })
            .catch(() => undefined);
          continue;
        }

        const calendarEventId = resolution.eventId;

        const task: TaskRecord = {
          id: metadata.id,
          title: item.title ?? "Untitled task",
          dueDate: metadata.dueDate ?? item.due ?? null,
          notes,
          projectName: metadata.projectName ?? "",
          categoryName: metadata.categoryName ?? "",
          memberEmails: metadata.memberEmails ?? [],
          createdAt: metadata.createdAt,
          updatedAt: metadata.updatedAt ?? item.updated ?? metadata.createdAt,
          completed: item.status === "completed",
          calendarSync: calendarEventId ? "synced" : metadata.calendarSync ?? "failed",
          tasksSync: item.id ? "synced" : metadata.tasksSync ?? "failed",
          calendarSyncMessage: calendarEventId
            ? "Calendar synced successfully."
            : metadata.calendarSyncMessage ?? "Calendar sync needs attention.",
          tasksSyncMessage: item.id
            ? "Google Tasks synced successfully."
            : metadata.tasksSyncMessage ?? "Google Tasks sync needs attention.",
          lastSyncAttemptedAt: metadata.lastSyncAttemptedAt,
          calendarEventId,
          googleTaskId: item.id ?? null
        };

        if (item.id && calendarEventId && calendarEventId !== metadata.calendarEventId) {
          await persistManagedTaskMetadataSafely(tasksApi, tasklistId, item.id, task);
        }

        collected.push(task);
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);
  } catch {
    return [];
  }

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
  const tasklistId = config.googleTasksListId || "@default";
  const calendar = google.calendar({ version: "v3", auth });
  const tasksApi = google.tasks({ version: "v1", auth });
  const timestamp = new Date().toISOString();
  const record: TaskRecord = {
    id: seed?.id ?? randomUUID(),
    title: input.title,
    dueDate: input.dueDate || null,
    notes: input.notes ?? "",
    projectName: input.projectName?.trim() ?? "",
    categoryName: input.categoryName?.trim() ?? "",
    memberEmails: input.memberEmails ?? [],
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
    tasklist: tasklistId,
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
    const calendarResponse = await calendar.events.insert({
      calendarId: config.googleCalendarId || "primary",
      requestBody: buildCalendarEventRequestBody(record),
      sendUpdates: "all"
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
    await persistManagedTaskMetadataSafely(tasksApi, tasklistId, record.googleTaskId, record);
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

  const auth = await buildAuthorizedClient(session);
  const config = await getAppConfig();
  const tasklistId = config.googleTasksListId || "@default";
  const calendar = google.calendar({ version: "v3", auth });
  const tasksApi = google.tasks({ version: "v1", auth });
  const nextTask: TaskRecord = {
    ...task,
    updatedAt: new Date().toISOString(),
    lastSyncAttemptedAt: new Date().toISOString()
  };

  try {
    const calendarResponse = nextTask.calendarEventId
      ? await calendar.events.update({
          calendarId: config.googleCalendarId || "primary",
          eventId: nextTask.calendarEventId,
          requestBody: buildCalendarEventRequestBody(nextTask),
          sendUpdates: "all"
        })
      : await calendar.events.insert({
          calendarId: config.googleCalendarId || "primary",
          requestBody: buildCalendarEventRequestBody(nextTask),
          sendUpdates: "all"
        });

    nextTask.calendarEventId = calendarResponse.data.id ?? nextTask.calendarEventId ?? null;
    nextTask.calendarSync = "synced";
    nextTask.calendarSyncMessage = "Calendar synced successfully.";
  } catch (error) {
    nextTask.calendarSync = "failed";
    nextTask.calendarSyncMessage =
      error instanceof Error ? error.message : "Calendar sync failed.";
  }

  try {
    const tasksResponse = nextTask.googleTaskId
      ? await tasksApi.tasks.update({
          tasklist: tasklistId,
          task: nextTask.googleTaskId,
          requestBody: {
            title: nextTask.title,
            notes: encodeManagedTaskNotes(nextTask.notes, nextTask),
            due: nextTask.dueDate ? new Date(nextTask.dueDate).toISOString() : undefined,
            status: nextTask.completed ? "completed" : "needsAction"
          }
        })
      : await tasksApi.tasks.insert({
          tasklist: tasklistId,
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
    if (nextTask.googleTaskId) {
      await persistManagedTaskMetadataSafely(
        tasksApi,
        tasklistId,
        nextTask.googleTaskId,
        nextTask
      );
    }
  } catch (error) {
    nextTask.tasksSync = "failed";
    nextTask.tasksSyncMessage =
      error instanceof Error ? error.message : "Google Tasks sync failed.";
    if (nextTask.googleTaskId) {
      await persistManagedTaskMetadataSafely(
        tasksApi,
        tasklistId,
        nextTask.googleTaskId,
        nextTask
      );
    }
  }

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
          attendees: (input.memberEmails ?? []).map((email) => ({ email })),
          start: {
            dateTime: startDate.toISOString()
          },
          end: {
            dateTime: endDate.toISOString()
          }
        },
        sendUpdates: "all"
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
            attendees: task.memberEmails.map((email) => ({ email })),
            start: { dateTime: startDate.toISOString() },
            end: { dateTime: endDate.toISOString() }
          },
          sendUpdates: "all"
        })
      : await calendar.events.insert({
          calendarId: config.googleCalendarId || "primary",
          requestBody: {
            summary: task.title,
            description: task.notes,
            attendees: task.memberEmails.map((email) => ({ email })),
            start: { dateTime: startDate.toISOString() },
            end: { dateTime: endDate.toISOString() }
          },
          sendUpdates: "all"
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
  const calendarId = config.googleCalendarId || "primary";
  const calendarEventId =
    task.calendarEventId ??
    (await findMatchingCalendarEventId(calendar, calendarId, task).catch(() => null));

  await Promise.allSettled([
    calendarEventId
      ? calendar.events.delete({
          calendarId,
          eventId: calendarEventId
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
