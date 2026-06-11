import { randomUUID } from "node:crypto";
import { readJsonFile, writeJsonFile } from "@/lib/file-store";
import {
  createGoogleBackedTask,
  deleteTaskFromGoogle,
  listGoogleBackedTasks,
  syncGoogleBackedTask,
  syncStoredTaskToGoogle,
  syncTaskToGoogle,
  type GoogleTokens
} from "@/lib/google";
import type { TaskInput, TaskRecord } from "@/types/task";

const tasksFileName = "tasks.json";

function getTaskStorageProvider() {
  return process.env.TASK_STORAGE_PROVIDER === "google" ? "google" : "local";
}

export type TaskBackup = {
  exportedAt: string;
  version: 1;
  tasks: TaskRecord[];
};

export async function listTasks(session: GoogleTokens | null = null) {
  if (getTaskStorageProvider() === "google") {
    return listGoogleBackedTasks(session);
  }

  const tasks = await readJsonFile<TaskRecord[]>(tasksFileName, []);
  return tasks.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createTaskAndSync(input: TaskInput, session: GoogleTokens | null) {
  if (getTaskStorageProvider() === "google") {
    return createGoogleBackedTask(input, session);
  }

  const syncResult = await syncTaskToGoogle(input, session);
  const tasks = await listTasks(session);
  const timestamp = new Date().toISOString();

  const task: TaskRecord = {
    id: randomUUID(),
    title: input.title,
    dueDate: input.dueDate || null,
    notes: input.notes ?? "",
    createdAt: timestamp,
    updatedAt: timestamp,
    completed: false,
    calendarSync: syncResult.calendar.status,
    tasksSync: syncResult.tasks.status,
    calendarSyncMessage: syncResult.calendar.message,
    tasksSyncMessage: syncResult.tasks.message,
    lastSyncAttemptedAt: timestamp,
    calendarEventId: syncResult.calendar.externalId,
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
  if (getTaskStorageProvider() === "google") {
    const tasks = await listTasks(session);
    const current = tasks.find((task) => task.id === taskId);

    if (!current) {
      return null;
    }

    return syncGoogleBackedTask(
      {
        ...current,
        title: input.title,
        dueDate: input.dueDate || null,
        notes: input.notes ?? "",
        completed: input.completed ?? current.completed
      },
      session
    );
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
    notes: input.notes ?? "",
    completed: input.completed ?? tasks[index].completed,
    updatedAt: new Date().toISOString()
  };

  const syncResult = await syncStoredTaskToGoogle(nextTask, session);

  nextTask.calendarSync = syncResult.calendar.status;
  nextTask.tasksSync = syncResult.tasks.status;
  nextTask.calendarSyncMessage = syncResult.calendar.message;
  nextTask.tasksSyncMessage = syncResult.tasks.message;
  nextTask.lastSyncAttemptedAt = new Date().toISOString();
  nextTask.calendarEventId = syncResult.calendar.externalId;
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

    return syncGoogleBackedTask(current, session);
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
    lastSyncAttemptedAt: new Date().toISOString(),
    calendarEventId: syncResult.calendar.externalId,
    googleTaskId: syncResult.tasks.externalId
  };

  tasks[index] = nextTask;
  await writeJsonFile(tasksFileName, tasks);

  return nextTask;
}

export async function retryFailedTaskSyncs(session: GoogleTokens | null) {
  const tasks = await listTasks(session);
  const failedTargets = tasks.filter(
    (task) => task.calendarSync !== "synced" || task.tasksSync !== "synced"
  );

  if (failedTargets.length === 0) {
    return [];
  }

  if (getTaskStorageProvider() === "google") {
    const refreshed: TaskRecord[] = [];

    for (const task of failedTargets) {
      refreshed.push(await syncGoogleBackedTask(task, session));
    }

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
      lastSyncAttemptedAt: new Date().toISOString(),
      calendarEventId: syncResult.calendar.externalId,
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
  }

  return true;
}

export async function exportTasksBackup(session: GoogleTokens | null = null): Promise<TaskBackup> {
  const tasks = await listTasks(session);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks
  };
}

export async function importTasksBackup(backup: TaskBackup, session: GoogleTokens | null = null) {
  if (getTaskStorageProvider() === "google") {
    const normalized = [...backup.tasks].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    );

    for (const task of normalized.reverse()) {
      await createGoogleBackedTask(
        {
          title: task.title,
          dueDate: task.dueDate ?? "",
          notes: task.notes
        },
        session,
        {
          id: task.id,
          createdAt: task.createdAt,
          completed: task.completed
        }
      );
    }

    return listTasks(session);
  }

  const normalized = [...backup.tasks].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );

  await writeJsonFile(tasksFileName, normalized);
  return normalized;
}
