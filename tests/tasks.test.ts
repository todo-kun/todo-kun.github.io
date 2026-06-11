import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

const originalCwd = process.cwd();
const workspace = path.resolve(originalCwd, ".test-workspace");
const workspaceDataDir = path.join(workspace, "data");

beforeEach(async () => {
  await mkdir(workspace, { recursive: true });
  await rm(workspaceDataDir, { recursive: true, force: true });
  process.chdir(workspace);
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REDIRECT_URI;
  delete process.env.APP_SECRET;
  delete process.env.TASK_STORAGE_PROVIDER;
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(workspaceDataDir, { recursive: true, force: true });
});

test("task lifecycle works end to end without Google config", async () => {
  const tasksModule = await import("../lib/tasks");

  const created = await tasksModule.createTaskAndSync(
    {
      title: "Prepare proposal",
      dueDate: "2026-06-15T10:00",
      notes: "Include pricing details"
    },
    null
  );

  assert.equal(created.title, "Prepare proposal");
  assert.equal(created.completed, false);
  assert.equal(created.calendarSync, "missing_config");
  assert.equal(created.tasksSync, "missing_config");
  assert.equal(created.calendarSyncMessage, "Google settings are incomplete.");
  assert.equal(created.tasksSyncMessage, "Google settings are incomplete.");
  assert.ok(created.lastSyncAttemptedAt);

  const storedAfterCreate = await tasksModule.listTasks();
  assert.equal(storedAfterCreate.length, 1);

  const updated = await tasksModule.updateTaskAndSync(
    created.id,
    {
      title: "Prepare final proposal",
      dueDate: "2026-06-15T12:00",
      notes: "Include pricing and delivery details",
      completed: true
    },
    null
  );

  assert.equal(updated?.completed, true);
  assert.equal(updated?.title, "Prepare final proposal");
  assert.equal(updated?.calendarSync, "missing_config");
  assert.equal(updated?.calendarSyncMessage, "Google settings are incomplete.");

  const retried = await tasksModule.retryTaskSync(created.id, null);
  assert.equal(retried?.tasksSync, "missing_config");

  const bulkRetried = await tasksModule.retryFailedTaskSyncs(null);
  assert.equal(bulkRetried.length, 1);
  assert.equal(bulkRetried[0]?.id, created.id);

  const deleted = await tasksModule.deleteTask(created.id, null);
  assert.equal(deleted, true);
  assert.equal((await tasksModule.listTasks()).length, 0);
});

test("tasks are persisted to the local data file", async () => {
  const tasksModule = await import("../lib/tasks");

  await tasksModule.createTaskAndSync(
    {
      title: "Call supplier",
      dueDate: "",
      notes: "Ask about lead time"
    },
    null
  );

  const raw = await readFile(path.join(process.cwd(), "data", "tasks.json"), "utf8");
  const parsed = JSON.parse(raw) as Array<{ title: string; calendarSyncMessage: string }>;

  assert.equal(parsed[0]?.title, "Call supplier");
  assert.equal(parsed[0]?.calendarSyncMessage, "Google settings are incomplete.");
});

test("tasks can be exported and imported as a backup", async () => {
  const tasksModule = await import("../lib/tasks");

  await tasksModule.createTaskAndSync(
    {
      title: "Backup target",
      dueDate: "2026-06-20T09:00",
      notes: "Keep this safe"
    },
    null
  );

  const backup = await tasksModule.exportTasksBackup();
  assert.equal(backup.version, 1);
  assert.equal(backup.tasks.length, 1);

  await tasksModule.importTasksBackup({
    version: 1,
    exportedAt: backup.exportedAt,
    tasks: [
      {
        ...backup.tasks[0],
        id: "restored-task",
        title: "Restored task"
      }
    ]
  });

  const restored = await tasksModule.listTasks();
  assert.equal(restored[0]?.title, "Restored task");
});
