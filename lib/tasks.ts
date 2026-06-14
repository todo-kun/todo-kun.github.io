import { randomUUID } from "node:crypto";
import { readJsonFile, writeJsonFile } from "@/lib/file-store";
import {
  readGoogleDriveAppState,
  writeGoogleDriveTaskSnapshot
} from "@/lib/google-drive-state";
import {
  createGoogleBackedTask,
  deleteTaskFromGoogle,
  listGoogleBackedTasks,
  syncGoogleBackedTask,
  syncStoredTaskToGoogle,
  syncTaskToGoogle,
  type GoogleTokens
} from "@/lib/google";
import { listRegisteredMembers, saveRegisteredMembers } from "@/lib/members";
import { ensureTaskTaxonomy, listTaxonomy, saveTaxonomy } from "@/lib/taxonomy";
import type { RegisteredMember, TaskInput, TaskRecord } from "@/types/task";

const tasksFileName = "tasks.json";

function getTaskStorageProvider() {
  return process.env.TASK_STORAGE_PROVIDER === "google" ? "google" : "local";
}

function normalizeTaskRecord(task: TaskRecord): TaskRecord {
  return {
    ...task,
    endDate: task.endDate ?? task.dueDate ?? null,
    syncToCalendar: task.syncToCalendar ?? true,
    syncToTasks: task.syncToTasks ?? true,
    reminderHoursBefore: task.reminderHoursBefore ?? null,
    dailyReminderHour: task.dailyReminderHour ?? null,
    projectName: task.projectName ?? "",
    categoryName: task.categoryName ?? "",
    memberEmails: task.memberEmails ?? [],
    reminderEventId: task.reminderEventId ?? null
  };
}

async function listGoogleDriveOnlyTasks(session: GoogleTokens | null) {
  const state = await readGoogleDriveAppState(session);
  return (state?.taskSnapshot ?? [])
    .map((task) => normalizeTaskRecord(task))
    .filter((task) => task.syncToTasks === false);
}

async function saveGoogleTaskSnapshot(
  googleTasks: TaskRecord[],
  driveOnlyTasks: TaskRecord[],
  session: GoogleTokens | null
) {
  const merged = [...googleTasks, ...driveOnlyTasks]
    .map((task) => normalizeTaskRecord(task))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  await writeGoogleDriveTaskSnapshot(merged, session).catch(() => null);
  return merged;
}

export type TaskBackup = {
  exportedAt: string;
  version: 1;
  tasks: TaskRecord[];
  taxonomy?: {
    projects: string[];
    categories: string[];
  };
  members?: RegisteredMember[];
};

export async function listTasks(session: GoogleTokens | null = null) {
  if (getTaskStorageProvider() === "google") {
    const [googleTasks, driveOnlyTasks] = await Promise.all([
      listGoogleBackedTasks(session),
      listGoogleDriveOnlyTasks(session)
    ]);
    return saveGoogleTaskSnapshot(googleTasks, driveOnlyTasks, session);
  }

  const tasks = await readJsonFile<TaskRecord[]>(tasksFileName, []);
  const normalized = tasks.map((task) => normalizeTaskRecord(task));
  return normalized.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createTaskAndSync(input: TaskInput, session: GoogleTokens | null) {
  await ensureTaskTaxonomy(input.projectName, input.categoryName);

  if (getTaskStorageProvider() === "google") {
    if (input.syncToTasks !== false) {
      const created = await createGoogleBackedTask(input, session);
      await saveGoogleTaskSnapshot(
        await listGoogleBackedTasks(session),
        await listGoogleDriveOnlyTasks(session),
        session
      );
      return created;
    }

    const timestamp = new Date().toISOString();
    const draft: TaskRecord = {
      id: randomUUID(),
      title: input.title,
      dueDate: input.dueDate || null,
      endDate: input.endDate || input.dueDate || null,
      syncToCalendar: input.syncToCalendar !== false,
      syncToTasks: false,
      reminderHoursBefore: input.reminderHoursBefore ?? null,
      dailyReminderHour: input.dailyReminderHour ?? null,
      notes: input.notes ?? "",
      projectName: input.projectName?.trim() ?? "",
      categoryName: input.categoryName?.trim() ?? "",
      memberEmails: input.memberEmails ?? [],
      createdAt: timestamp,
      updatedAt: timestamp,
      completed: false,
      calendarSync: "disabled",
      tasksSync: "disabled",
      calendarSyncMessage: "Not selected for sync.",
      tasksSyncMessage: "Not selected for sync.",
      lastSyncAttemptedAt: null,
      calendarEventId: null,
      reminderEventId: null,
      googleTaskId: null
    };
    const syncResult = await syncStoredTaskToGoogle(draft, session);
    const created = normalizeTaskRecord({
      ...draft,
      calendarSync: syncResult.calendar.status,
      tasksSync: syncResult.tasks.status,
      calendarSyncMessage: syncResult.calendar.message,
      tasksSyncMessage: syncResult.tasks.message,
      lastSyncAttemptedAt: draft.syncToCalendar ? timestamp : null,
      calendarEventId: syncResult.calendar.externalId,
      reminderEventId: syncResult.calendar.reminderExternalId ?? null,
      googleTaskId: syncResult.tasks.externalId
    });
    await saveGoogleTaskSnapshot(
      await listGoogleBackedTasks(session),
      [...(await listGoogleDriveOnlyTasks(session)), created],
      session
    );
    return created;
  }

  const syncResult = await syncTaskToGoogle(input, session);
  const tasks = await listTasks(session);
  const timestamp = new Date().toISOString();

  const task: TaskRecord = {
    id: randomUUID(),
    title: input.title,
    dueDate: input.dueDate || null,
    endDate: input.endDate || input.dueDate || null,
    syncToCalendar: input.syncToCalendar !== false,
    syncToTasks: input.syncToTasks !== false,
    reminderHoursBefore: input.reminderHoursBefore ?? null,
    dailyReminderHour: input.dailyReminderHour ?? null,
    notes: input.notes ?? "",
    projectName: input.projectName?.trim() ?? "",
    categoryName: input.categoryName?.trim() ?? "",
    memberEmails: input.memberEmails ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
    completed: false,
    calendarSync: syncResult.calendar.status,
    tasksSync: syncResult.tasks.status,
    calendarSyncMessage: syncResult.calendar.message,
    tasksSyncMessage: syncResult.tasks.message,
    lastSyncAttemptedAt:
      input.syncToCalendar === false && input.syncToTasks === false ? null : timestamp,
    calendarEventId: syncResult.calendar.externalId,
    reminderEventId: syncResult.calendar.reminderExternalId ?? null,
    googleTaskId: syncResult.tasks.externalId
  };

  await writeJsonFile(tasksFileName, [task, ...tasks]);

  return task;
}

export async function getTask(taskId: string) {
  const tasks = await listTasks();
  return tasks.find((task) => task.id === taskId) ?? null;
}

export async function updateTaskAndSync(
  taskId: string,
  input: TaskInput & { completed?: boolean },
  session: GoogleTokens | null
) {
  await ensureTaskTaxonomy(input.projectName, input.categoryName);

  if (getTaskStorageProvider() === "google") {
    const tasks = await listTasks(session);
    const current = tasks.find((task) => task.id === taskId);

    if (!current) {
      return null;
    }

    const candidate: TaskRecord = {
      ...current,
      title: input.title,
      dueDate: input.dueDate || null,
      endDate: input.endDate || input.dueDate || null,
      syncToCalendar: current.syncToCalendar,
      syncToTasks: current.syncToTasks,
      reminderHoursBefore: input.reminderHoursBefore ?? null,
      dailyReminderHour: input.dailyReminderHour ?? null,
      notes: input.notes ?? "",
      projectName: input.projectName?.trim() ?? "",
      categoryName: input.categoryName?.trim() ?? "",
      memberEmails: input.memberEmails ?? [],
      completed: input.completed ?? current.completed
    };

    if (current.syncToTasks) {
      const updated = await syncGoogleBackedTask(candidate, session);
      await saveGoogleTaskSnapshot(
        await listGoogleBackedTasks(session),
        await listGoogleDriveOnlyTasks(session),
        session
      );
      return updated;
    }

    const syncResult = await syncStoredTaskToGoogle(candidate, session);
    const updated = normalizeTaskRecord({
      ...candidate,
      calendarSync: syncResult.calendar.status,
      tasksSync: syncResult.tasks.status,
      calendarSyncMessage: syncResult.calendar.message,
      tasksSyncMessage: syncResult.tasks.message,
      lastSyncAttemptedAt: candidate.syncToCalendar ? new Date().toISOString() : current.lastSyncAttemptedAt,
      calendarEventId: syncResult.calendar.externalId,
      reminderEventId: syncResult.calendar.reminderExternalId ?? candidate.reminderEventId ?? null,
      googleTaskId: syncResult.tasks.externalId
    });
    await saveGoogleTaskSnapshot(
      await listGoogleBackedTasks(session),
      (await listGoogleDriveOnlyTasks(session)).map((task) => (task.id === taskId ? updated : task)),
      session
    );
    return updated;
  }

  const tasks = await listTasks(session);
  const index = tasks.findIndex((task) => task.id === taskId);

  if (index === -1) {
    return null;
  }

  const nextTask: TaskRecord = {
    ...tasks[index],
    title: input.title,
    dueDate: input.dueDate || null,
    endDate: input.endDate || input.dueDate || null,
    syncToCalendar: input.syncToCalendar ?? tasks[index].syncToCalendar ?? true,
    syncToTasks: input.syncToTasks ?? tasks[index].syncToTasks ?? true,
    reminderHoursBefore: input.reminderHoursBefore ?? null,
    dailyReminderHour: input.dailyReminderHour ?? null,
    notes: input.notes ?? "",
    projectName: input.projectName?.trim() ?? "",
    categoryName: input.categoryName?.trim() ?? "",
    memberEmails: input.memberEmails ?? [],
    completed: input.completed ?? tasks[index].completed,
    updatedAt: new Date().toISOString()
  };

  const syncResult = await syncStoredTaskToGoogle(nextTask, session);

  nextTask.calendarSync = syncResult.calendar.status;
  nextTask.tasksSync = syncResult.tasks.status;
  nextTask.calendarSyncMessage = syncResult.calendar.message;
  nextTask.tasksSyncMessage = syncResult.tasks.message;
  nextTask.lastSyncAttemptedAt =
    nextTask.syncToCalendar || nextTask.syncToTasks ? new Date().toISOString() : nextTask.lastSyncAttemptedAt;
  nextTask.calendarEventId = syncResult.calendar.externalId;
  nextTask.reminderEventId = syncResult.calendar.reminderExternalId ?? nextTask.reminderEventId ?? null;
  nextTask.googleTaskId = syncResult.tasks.externalId;

  tasks[index] = nextTask;
  await writeJsonFile(tasksFileName, tasks);

  return nextTask;
}

export async function retryTaskSync(taskId: string, session: GoogleTokens | null) {
  if (getTaskStorageProvider() === "google") {
    const tasks = await listTasks(session);
    const current = tasks.find((task) => task.id === taskId);

    if (!current) {
      return null;
    }

    if (current.syncToTasks) {
      const refreshed = await syncGoogleBackedTask(current, session);
      await saveGoogleTaskSnapshot(
        await listGoogleBackedTasks(session),
        await listGoogleDriveOnlyTasks(session),
        session
      );
      return refreshed;
    }

    const syncResult = await syncStoredTaskToGoogle(current, session);
    const refreshed = normalizeTaskRecord({
      ...current,
      updatedAt: new Date().toISOString(),
      calendarSync: syncResult.calendar.status,
      tasksSync: syncResult.tasks.status,
      calendarSyncMessage: syncResult.calendar.message,
      tasksSyncMessage: syncResult.tasks.message,
      lastSyncAttemptedAt: current.syncToCalendar ? new Date().toISOString() : current.lastSyncAttemptedAt,
      calendarEventId: syncResult.calendar.externalId,
      reminderEventId: syncResult.calendar.reminderExternalId ?? current.reminderEventId ?? null,
      googleTaskId: syncResult.tasks.externalId
    });
    await saveGoogleTaskSnapshot(
      await listGoogleBackedTasks(session),
      (await listGoogleDriveOnlyTasks(session)).map((task) => (task.id === taskId ? refreshed : task)),
      session
    );
    return refreshed;
  }

  const tasks = await listTasks(session);
  const index = tasks.findIndex((task) => task.id === taskId);

  if (index === -1) {
    return null;
  }

  const syncResult = await syncStoredTaskToGoogle(tasks[index], session);

  const nextTask: TaskRecord = {
    ...tasks[index],
    updatedAt: new Date().toISOString(),
    calendarSync: syncResult.calendar.status,
    tasksSync: syncResult.tasks.status,
    calendarSyncMessage: syncResult.calendar.message,
    tasksSyncMessage: syncResult.tasks.message,
    lastSyncAttemptedAt:
      tasks[index].syncToCalendar || tasks[index].syncToTasks
        ? new Date().toISOString()
        : tasks[index].lastSyncAttemptedAt,
    calendarEventId: syncResult.calendar.externalId,
    reminderEventId: syncResult.calendar.reminderExternalId ?? tasks[index].reminderEventId ?? null,
    googleTaskId: syncResult.tasks.externalId
  };

  tasks[index] = nextTask;
  await writeJsonFile(tasksFileName, tasks);

  return nextTask;
}

export async function retryFailedTaskSyncs(session: GoogleTokens | null) {
  const tasks = await listTasks(session);
  const failedTargets = tasks.filter(
    (task) =>
      (task.syncToCalendar && task.calendarSync !== "synced") ||
      (task.syncToTasks && task.tasksSync !== "synced")
  );

  if (failedTargets.length === 0) {
    return [];
  }

  if (getTaskStorageProvider() === "google") {
    const refreshed: TaskRecord[] = [];

    for (const task of failedTargets) {
      if (task.syncToTasks) {
        refreshed.push(await syncGoogleBackedTask(task, session));
        continue;
      }

      const syncResult = await syncStoredTaskToGoogle(task, session);
      refreshed.push(
        normalizeTaskRecord({
          ...task,
          updatedAt: new Date().toISOString(),
          calendarSync: syncResult.calendar.status,
          tasksSync: syncResult.tasks.status,
          calendarSyncMessage: syncResult.calendar.message,
          tasksSyncMessage: syncResult.tasks.message,
          lastSyncAttemptedAt: task.syncToCalendar ? new Date().toISOString() : task.lastSyncAttemptedAt,
          calendarEventId: syncResult.calendar.externalId,
          reminderEventId: syncResult.calendar.reminderExternalId ?? task.reminderEventId ?? null,
          googleTaskId: syncResult.tasks.externalId
        })
      );
    }

    const syncedDriveOnly = refreshed.filter((task) => task.syncToTasks === false);
    await saveGoogleTaskSnapshot(
      await listGoogleBackedTasks(session),
      [
        ...(await listGoogleDriveOnlyTasks(session)).filter(
          (task) => !syncedDriveOnly.some((item) => item.id === task.id)
        ),
        ...syncedDriveOnly
      ],
      session
    );
    return refreshed;
  }

  const updatedTasks = [...tasks];
  const refreshed: TaskRecord[] = [];

  for (const task of failedTargets) {
    const index = updatedTasks.findIndex((item) => item.id === task.id);

    if (index === -1) {
      continue;
    }

    const syncResult = await syncStoredTaskToGoogle(updatedTasks[index], session);
    const nextTask: TaskRecord = {
      ...updatedTasks[index],
      updatedAt: new Date().toISOString(),
      calendarSync: syncResult.calendar.status,
      tasksSync: syncResult.tasks.status,
      calendarSyncMessage: syncResult.calendar.message,
      tasksSyncMessage: syncResult.tasks.message,
      lastSyncAttemptedAt:
        updatedTasks[index].syncToCalendar || updatedTasks[index].syncToTasks
          ? new Date().toISOString()
          : updatedTasks[index].lastSyncAttemptedAt,
      calendarEventId: syncResult.calendar.externalId,
      reminderEventId:
        syncResult.calendar.reminderExternalId ?? updatedTasks[index].reminderEventId ?? null,
      googleTaskId: syncResult.tasks.externalId
    };

    updatedTasks[index] = nextTask;
    refreshed.push(nextTask);
  }

  await writeJsonFile(tasksFileName, updatedTasks);

  return refreshed;
}

export async function deleteTask(taskId: string, session: GoogleTokens | null) {
  const tasks = await listTasks(session);
  const task = tasks.find((item) => item.id === taskId);

  if (!task) {
    return false;
  }

  await deleteTaskFromGoogle(task, session);
  if (getTaskStorageProvider() === "local") {
    await writeJsonFile(
      tasksFileName,
      tasks.filter((item) => item.id !== taskId)
    );
  } else {
    await saveGoogleTaskSnapshot(
      await listGoogleBackedTasks(session),
      (await listGoogleDriveOnlyTasks(session)).filter((item) => item.id !== taskId),
      session
    );
  }

  return true;
}

export async function exportTasksBackup(session: GoogleTokens | null = null): Promise<TaskBackup> {
  const tasks = await listTasks(session);
  const taxonomy = await listTaxonomy();
  const members = await listRegisteredMembers();

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks,
    taxonomy,
    members
  };
}

export async function importTasksBackup(backup: TaskBackup, session: GoogleTokens | null = null) {
  if (backup.taxonomy) {
    await saveTaxonomy(backup.taxonomy);
  }

  if (backup.members) {
    await saveRegisteredMembers(backup.members);
  }

  if (getTaskStorageProvider() === "google") {
    const normalized = [...backup.tasks].map((task) => normalizeTaskRecord(task)).sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    );

    for (const task of normalized.reverse()) {
      if (task.syncToTasks) {
        await createGoogleBackedTask(
          {
            title: task.title,
            dueDate: task.dueDate ?? "",
            endDate: task.endDate ?? task.dueDate ?? "",
            syncToCalendar: task.syncToCalendar,
            syncToTasks: true,
            reminderHoursBefore: task.reminderHoursBefore ?? undefined,
            dailyReminderHour: task.dailyReminderHour ?? undefined,
            notes: task.notes,
            projectName: task.projectName ?? "",
            categoryName: task.categoryName ?? "",
            memberEmails: task.memberEmails ?? []
          },
          session,
          {
            id: task.id,
            createdAt: task.createdAt,
            completed: task.completed
          }
        );
        continue;
      }

      const syncResult = await syncStoredTaskToGoogle(task, session);
      const imported = normalizeTaskRecord({
        ...task,
        calendarSync: syncResult.calendar.status,
        tasksSync: syncResult.tasks.status,
        calendarSyncMessage: syncResult.calendar.message,
        tasksSyncMessage: syncResult.tasks.message,
        lastSyncAttemptedAt: task.syncToCalendar ? new Date().toISOString() : task.lastSyncAttemptedAt,
        calendarEventId: syncResult.calendar.externalId,
        reminderEventId: syncResult.calendar.reminderExternalId ?? task.reminderEventId ?? null,
        googleTaskId: syncResult.tasks.externalId
      });
      await saveGoogleTaskSnapshot(
        await listGoogleBackedTasks(session),
        [...(await listGoogleDriveOnlyTasks(session)), imported],
        session
      );
    }

    const tasks = await listTasks(session);
    await saveGoogleTaskSnapshot(
      await listGoogleBackedTasks(session),
      tasks.filter((task) => task.syncToTasks === false),
      session
    );
    return tasks;
  }

  const normalized = [...backup.tasks].map((task) => normalizeTaskRecord(task)).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );

  for (const task of normalized) {
    await ensureTaskTaxonomy(task.projectName, task.categoryName);
  }

  await writeJsonFile(tasksFileName, normalized);
  return normalized;
}
