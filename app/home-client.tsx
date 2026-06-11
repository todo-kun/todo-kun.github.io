"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import type { TaskRecord } from "@/types/task";

type GoogleStatus = {
  configured: boolean;
  connected: boolean;
  ok: boolean;
};

type TasksResponse = {
  ok: boolean;
  tasks: TaskRecord[];
};

type SettingsResponse = {
  ok: boolean;
  config: {
    googleClientId: string;
    googleRedirectUri: string;
    googleCalendarId: string;
    googleTasksListId: string;
    appUrl: string;
    googleClientSecretConfigured: boolean;
    appSecretConfigured: boolean;
  };
};

type SettingsHealthResponse = {
  ok: boolean;
  health: {
    googleClientId: boolean;
    googleClientSecret: boolean;
    googleRedirectUri: boolean;
    googleCalendarId: boolean;
    googleTasksListId: boolean;
    appUrl: boolean;
    appSecret: boolean;
    readyForGoogleConnect: boolean;
  };
};

type TaskMutationResponse = {
  ok: boolean;
  task?: TaskRecord;
  error?: string;
};

type BulkSyncResponse = {
  ok: boolean;
  tasks: TaskRecord[];
};

type BackupResponse = {
  ok: boolean;
  backup: {
    version: 1;
    exportedAt: string;
    tasks: TaskRecord[];
  };
};

const syncLabels = {
  synced: "Synced",
  not_connected: "Google not connected",
  missing_config: "Google config missing",
  failed: "Sync failed"
} as const;

const emptyForm = {
  title: "",
  dueDate: "",
  notes: ""
};

const emptySettingsForm = {
  googleClientId: "",
  googleClientSecret: "",
  googleRedirectUri: "",
  googleCalendarId: "primary",
  googleTasksListId: "@default",
  appUrl: "http://localhost:3000",
  appSecret: ""
};

const emptySettingsHealth = {
  googleClientId: false,
  googleClientSecret: false,
  googleRedirectUri: false,
  googleCalendarId: false,
  googleTasksListId: false,
  appUrl: false,
  appSecret: false,
  readyForGoogleConnect: false
};

export function HomeClient({
  initialMessage,
  shouldCleanQuery
}: {
  initialMessage: string;
  shouldCleanQuery: boolean;
}) {
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState(initialMessage);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [settingsForm, setSettingsForm] = useState(emptySettingsForm);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus>({
    configured: false,
    connected: false,
    ok: true
  });
  const [settingsConfigured, setSettingsConfigured] = useState({
    googleClientSecretConfigured: false,
    appSecretConfigured: false
  });
  const [settingsHealth, setSettingsHealth] = useState(emptySettingsHealth);
  const [isSaving, startSavingTransition] = useTransition();
  const [isLoading, startLoadingTransition] = useTransition();
  const [isDisconnecting, startDisconnectTransition] = useTransition();
  const [isBulkSyncing, startBulkSyncTransition] = useTransition();
  const [isSavingSettings, startSettingsTransition] = useTransition();
  const [isExporting, startExportTransition] = useTransition();
  const [isImporting, startImportTransition] = useTransition();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  useEffect(() => {
    void refreshStatus();
    void refreshTasks();
    void refreshSettings();
    void refreshSettingsHealth();

    if (shouldCleanQuery) {
      window.history.replaceState({}, "", "/");
    }
  }, [shouldCleanQuery]);

  async function refreshStatus() {
    const response = await fetch("/api/google/status", { cache: "no-store" });
    const result = (await response.json()) as GoogleStatus;
    setGoogleStatus(result);
  }

  async function refreshTasks() {
    startLoadingTransition(async () => {
      const response = await fetch("/api/tasks", { cache: "no-store" });
      const result = (await response.json()) as TasksResponse;
      setTasks(result.tasks);
    });
  }

  async function refreshSettings() {
    const response = await fetch("/api/settings", { cache: "no-store" });
    const result = (await response.json()) as SettingsResponse;

    setSettingsForm((current) => ({
      ...current,
      googleClientId: result.config.googleClientId,
      googleClientSecret: "",
      googleRedirectUri: result.config.googleRedirectUri,
      googleCalendarId: result.config.googleCalendarId,
      googleTasksListId: result.config.googleTasksListId,
      appUrl: result.config.appUrl,
      appSecret: ""
    }));
    setSettingsConfigured({
      googleClientSecretConfigured: result.config.googleClientSecretConfigured,
      appSecretConfigured: result.config.appSecretConfigured
    });
  }

  async function refreshSettingsHealth() {
    const response = await fetch("/api/settings/health", { cache: "no-store" });
    const result = (await response.json()) as SettingsHealthResponse;
    setSettingsHealth(result.health);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    startSavingTransition(async () => {
      try {
        const response = await fetch(editingTaskId ? `/api/tasks/${editingTaskId}` : "/api/tasks", {
          method: editingTaskId ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            ...form,
            completed: editingTaskId
              ? tasks.find((task) => task.id === editingTaskId)?.completed ?? false
              : undefined
          })
        });

        const result = (await response.json()) as TaskMutationResponse;

        if (!response.ok || !result.task) {
          throw new Error(result.error ?? "Task could not be saved.");
        }

        const savedTask = result.task;

        if (editingTaskId) {
          setTasks((current) => current.map((task) => (task.id === savedTask.id ? savedTask : task)));
          setMessage("Task updated successfully.");
        } else {
          setTasks((current) => [savedTask, ...current]);
          setMessage("Task created successfully.");
        }

        setForm(emptyForm);
        setEditingTaskId(null);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "An unexpected error occurred.");
      }
    });
  }

  async function handleDisconnect() {
    startDisconnectTransition(async () => {
      await fetch("/api/google/disconnect", { method: "POST" });
      await refreshStatus();
      setMessage("Google account disconnected.");
    });
  }

  async function handleSettingsSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    startSettingsTransition(async () => {
      try {
        const response = await fetch("/api/settings", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(settingsForm)
        });

        const result = (await response.json()) as SettingsResponse;

        if (!response.ok) {
          throw new Error("Settings could not be saved.");
        }

        setSettingsConfigured({
          googleClientSecretConfigured: result.config.googleClientSecretConfigured,
          appSecretConfigured: result.config.appSecretConfigured
        });
        setSettingsForm((current) => ({
          ...current,
          googleClientSecret: "",
          appSecret: ""
        }));
        await refreshStatus();
        await refreshSettings();
        await refreshSettingsHealth();
        setMessage("App settings saved.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "An unexpected error occurred.");
      }
    });
  }

  function startEdit(task: TaskRecord) {
    setEditingTaskId(task.id);
    setForm({
      title: task.title,
      dueDate: task.dueDate ?? "",
      notes: task.notes
    });
    setMessage(`Editing "${task.title}"`);
  }

  function cancelEdit() {
    setEditingTaskId(null);
    setForm(emptyForm);
    setMessage("Edit cancelled.");
  }

  async function mutateTask(taskId: string, action: "sync" | "toggle" | "delete") {
    setActiveTaskId(taskId);
    setMessage("");

    try {
      if (action === "delete") {
        const response = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });

        if (!response.ok) {
          const result = (await response.json()) as TaskMutationResponse;
          throw new Error(result.error ?? "Task could not be deleted.");
        }

        setTasks((current) => current.filter((task) => task.id !== taskId));

        if (editingTaskId === taskId) {
          setEditingTaskId(null);
          setForm(emptyForm);
        }

        setMessage("Task deleted.");
        return;
      }

      const targetTask = tasks.find((task) => task.id === taskId);

      if (!targetTask) {
        throw new Error("Task not found.");
      }

      const response = await fetch(
        action === "sync" ? `/api/tasks/${taskId}/sync` : `/api/tasks/${taskId}`,
        {
          method: action === "sync" ? "POST" : "PUT",
          headers:
            action === "toggle"
              ? {
                  "Content-Type": "application/json"
                }
              : undefined,
          body:
            action === "toggle"
              ? JSON.stringify({
                  title: targetTask.title,
                  dueDate: targetTask.dueDate ?? "",
                  notes: targetTask.notes,
                  completed: !targetTask.completed
                })
              : undefined
        }
      );

      const result = (await response.json()) as TaskMutationResponse;

      if (!response.ok || !result.task) {
        throw new Error(result.error ?? "Task action failed.");
      }

      const updatedTask = result.task;

      setTasks((current) => current.map((task) => (task.id === updatedTask.id ? updatedTask : task)));
      setMessage(
        action === "sync"
          ? "Task sync retried."
          : updatedTask.completed
            ? "Task marked complete."
            : "Task marked active."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "An unexpected error occurred.");
    } finally {
      setActiveTaskId(null);
    }
  }

  async function handleBulkSync() {
    startBulkSyncTransition(async () => {
      setMessage("");

      try {
        const response = await fetch("/api/tasks/sync", { method: "POST" });
        const result = (await response.json()) as BulkSyncResponse;

        if (!response.ok) {
          throw new Error("Bulk sync could not be completed.");
        }

        if (result.tasks.length === 0) {
          setMessage("All tasks are already synced.");
          return;
        }

        const nextTasks = new Map(result.tasks.map((task) => [task.id, task]));
        setTasks((current) => current.map((task) => nextTasks.get(task.id) ?? task));
        setMessage(`${result.tasks.length} task(s) retried for sync.`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "An unexpected error occurred.");
      }
    });
  }

  async function handleExportBackup() {
    startExportTransition(async () => {
      setMessage("");

      try {
        const response = await fetch("/api/backup", { cache: "no-store" });
        const result = (await response.json()) as BackupResponse;

        if (!response.ok) {
          throw new Error("Backup export could not be created.");
        }

        const blob = new Blob([JSON.stringify(result.backup, null, 2)], {
          type: "application/json"
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const stamp = new Date(result.backup.exportedAt).toISOString().replaceAll(":", "-");

        link.href = url;
        link.download = `task-sync-backup-${stamp}.json`;
        link.click();
        URL.revokeObjectURL(url);
        setMessage("Backup exported.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "An unexpected error occurred.");
      }
    });
  }

  async function handleImportBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    startImportTransition(async () => {
      setMessage("");

      try {
        const text = await file.text();
        const response = await fetch("/api/backup", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: text
        });

        const result = (await response.json()) as BulkSyncResponse & { error?: string };

        if (!response.ok) {
          throw new Error(result.error ?? "Backup import failed.");
        }

        setTasks(result.tasks);
        setMessage("Backup imported.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "An unexpected error occurred.");
      } finally {
        event.target.value = "";
      }
    });
  }

  const visibleTasks = tasks.filter((task) => {
    if (filter === "open") {
      return !task.completed;
    }

    if (filter === "done") {
      return task.completed;
    }

    return true;
  });

  const taskSummary = {
    total: tasks.length,
    open: tasks.filter((task) => !task.completed).length,
    done: tasks.filter((task) => task.completed).length,
    syncPending: tasks.filter(
      (task) => task.calendarSync !== "synced" || task.tasksSync !== "synced"
    ).length
  };

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">Browser First Task Hub</p>
          <h1>One task entry, synced across your calendar and to-do list.</h1>
          <p className="lead">
            Manage work from desktop or phone in the browser, then push each task to Google
            Calendar and Google Tasks from one place.
          </p>
        </div>

        <div className="hero-status">
          <div className="status-pill">
            <span className="status-dot" data-active={googleStatus.connected} />
            <span>
              {googleStatus.connected
                ? "Google connected"
                : googleStatus.configured
                  ? "Ready to connect Google"
                  : "Google setup required"}
            </span>
          </div>

          <div className="action-row">
            {googleStatus.connected ? (
              <button
                className="secondary-button"
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                type="button"
              >
                {isDisconnecting ? "Disconnecting..." : "Disconnect Google"}
              </button>
            ) : (
              <a className="primary-link" href="/api/google/connect">
                Connect Google
              </a>
            )}
          </div>
        </div>
      </section>

      <section className="content-grid">
        <form className="task-card" onSubmit={handleSubmit}>
          <div className="section-heading">
            <h2>{editingTaskId ? "Edit task" : "Create task"}</h2>
            <p>
              Save the task in this app and, when Google is connected, sync it to Calendar and
              Google Tasks automatically.
            </p>
          </div>

          <label>
            Title
            <input
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Review estimate document"
              required
            />
          </label>

          <label>
            Due date
            <input
              type="datetime-local"
              value={form.dueDate}
              onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))}
            />
          </label>

          <label>
            Notes
            <textarea
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Add context, assignee, or meeting notes"
              rows={5}
            />
          </label>

          <div className="action-row">
            <button type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : editingTaskId ? "Save changes" : "Create task"}
            </button>
            {editingTaskId ? (
              <button className="ghost-button" type="button" onClick={cancelEdit}>
                Cancel
              </button>
            ) : null}
          </div>

          {message ? <p className="status-message">{message}</p> : null}
        </form>

        <aside className="info-card">
          <div className="section-heading">
            <h2>App settings</h2>
          </div>
          <form className="settings-form" onSubmit={handleSettingsSave}>
            <label>
              Google Client ID
              <input
                value={settingsForm.googleClientId}
                onChange={(event) =>
                  setSettingsForm((current) => ({ ...current, googleClientId: event.target.value }))
                }
                placeholder="Google OAuth client ID"
              />
            </label>
            <label>
              Google Client Secret
              <input
                type="password"
                value={settingsForm.googleClientSecret}
                onChange={(event) =>
                  setSettingsForm((current) => ({ ...current, googleClientSecret: event.target.value }))
                }
                placeholder={
                  settingsConfigured.googleClientSecretConfigured
                    ? "Already saved. Enter only to replace."
                    : "Google OAuth client secret"
                }
              />
            </label>
            <label>
              Redirect URI
              <input
                value={settingsForm.googleRedirectUri}
                onChange={(event) =>
                  setSettingsForm((current) => ({ ...current, googleRedirectUri: event.target.value }))
                }
                placeholder="http://localhost:3000/api/google/callback"
              />
            </label>
            <label>
              Calendar ID
              <input
                value={settingsForm.googleCalendarId}
                onChange={(event) =>
                  setSettingsForm((current) => ({ ...current, googleCalendarId: event.target.value }))
                }
                placeholder="primary"
              />
            </label>
            <label>
              Tasks List ID
              <input
                value={settingsForm.googleTasksListId}
                onChange={(event) =>
                  setSettingsForm((current) => ({ ...current, googleTasksListId: event.target.value }))
                }
                placeholder="@default"
              />
            </label>
            <label>
              App URL
              <input
                value={settingsForm.appUrl}
                onChange={(event) =>
                  setSettingsForm((current) => ({ ...current, appUrl: event.target.value }))
                }
                placeholder="http://localhost:3000"
              />
            </label>
            <label>
              App Secret
              <input
                type="password"
                value={settingsForm.appSecret}
                onChange={(event) =>
                  setSettingsForm((current) => ({ ...current, appSecret: event.target.value }))
                }
                placeholder={
                  settingsConfigured.appSecretConfigured
                    ? "Already saved. Enter only to replace."
                    : "Long random secret"
                }
              />
            </label>
            <div className="settings-hints">
              <p>
                {settingsConfigured.appSecretConfigured
                  ? "App Secret is already stored. Leave it empty to keep the current value."
                  : "If App Secret is left empty, the app will generate one automatically."}
              </p>
            </div>
            <button type="submit" disabled={isSavingSettings}>
              {isSavingSettings ? "Saving settings..." : "Save settings"}
            </button>
          </form>
        </aside>
      </section>

      <section className="setup-card">
        <div className="section-heading">
          <h2>Setup checklist</h2>
          <p>Fill these items to make Google connection available in the browser.</p>
        </div>
        <div className="checklist-grid">
          <SetupItem label="Google Client ID" ready={settingsHealth.googleClientId} />
          <SetupItem label="Google Client Secret" ready={settingsHealth.googleClientSecret} />
          <SetupItem label="Redirect URI" ready={settingsHealth.googleRedirectUri} />
          <SetupItem label="Calendar ID" ready={settingsHealth.googleCalendarId} />
          <SetupItem label="Tasks List ID" ready={settingsHealth.googleTasksListId} />
          <SetupItem label="App URL" ready={settingsHealth.appUrl} />
          <SetupItem label="App Secret" ready={settingsHealth.appSecret} />
        </div>
        <p className="setup-summary">
          {settingsHealth.readyForGoogleConnect
            ? "Google connection is ready to start from this browser."
            : "Save the missing items above, then connect Google."}
        </p>
      </section>

      <section className="stats-grid" aria-label="Task summary">
        <article className="stat-card">
          <span className="stat-label">Total tasks</span>
          <strong>{taskSummary.total}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Open</span>
          <strong>{taskSummary.open}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Done</span>
          <strong>{taskSummary.done}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Sync pending</span>
          <strong>{taskSummary.syncPending}</strong>
        </article>
      </section>

      <section className="list-card">
        <div className="section-heading section-heading-row">
          <div>
            <h2>Task list</h2>
            <p>Your recent tasks are stored here and keep their sync status.</p>
          </div>
          <div className="toolbar-row">
            <div className="filter-row" role="tablist" aria-label="Task filters">
              <button
                className="ghost-button"
                data-selected={filter === "all"}
                onClick={() => setFilter("all")}
                type="button"
              >
                All
              </button>
              <button
                className="ghost-button"
                data-selected={filter === "open"}
                onClick={() => setFilter("open")}
                type="button"
              >
                Open
              </button>
              <button
                className="ghost-button"
                data-selected={filter === "done"}
                onClick={() => setFilter("done")}
                type="button"
              >
                Done
              </button>
            </div>
            <button
              className="ghost-button"
              disabled={isBulkSyncing || taskSummary.syncPending === 0}
              onClick={() => void handleBulkSync()}
              type="button"
            >
              {isBulkSyncing ? "Syncing..." : "Retry all pending syncs"}
            </button>
            <button
              className="ghost-button"
              disabled={isExporting}
              onClick={() => void handleExportBackup()}
              type="button"
            >
              {isExporting ? "Exporting..." : "Export backup"}
            </button>
            <label className="ghost-button file-button">
              {isImporting ? "Importing..." : "Import backup"}
              <input
                accept="application/json"
                className="file-input"
                disabled={isImporting}
                onChange={(event) => void handleImportBackup(event)}
                type="file"
              />
            </label>
            <button
              className="ghost-button"
              onClick={() => void refreshTasks()}
              disabled={isLoading}
              type="button"
            >
              {isLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="task-list">
          {visibleTasks.length === 0 ? (
            <div className="empty-state">
              <p>
                {tasks.length === 0 ? "No tasks yet. Create your first task above." : "No tasks in this filter."}
              </p>
            </div>
          ) : (
            visibleTasks.map((task) => (
              <article className="task-item" data-completed={task.completed} key={task.id}>
                <div className="task-main">
                  <div className="task-title-row">
                    <h3>{task.title}</h3>
                    <span className="task-badge">{task.completed ? "Done" : "Open"}</span>
                  </div>
                  <p>{task.notes || "No notes added."}</p>
                </div>

                <dl className="task-meta">
                  <div>
                    <dt>Due</dt>
                    <dd>{task.dueDate ? formatDate(task.dueDate) : "Not set"}</dd>
                  </div>
                  <div>
                    <dt>Calendar</dt>
                    <dd>{syncLabels[task.calendarSync]}</dd>
                  </div>
                  <div>
                    <dt>Tasks</dt>
                    <dd>{syncLabels[task.tasksSync]}</dd>
                  </div>
                </dl>

                <div className="sync-details">
                  <p>
                    <strong>Calendar:</strong> {task.calendarSyncMessage}
                  </p>
                  <p>
                    <strong>Tasks:</strong> {task.tasksSyncMessage}
                  </p>
                  <p>
                    <strong>Last sync:</strong>{" "}
                    {task.lastSyncAttemptedAt ? formatDate(task.lastSyncAttemptedAt) : "Not attempted yet"}
                  </p>
                </div>

                <div className="task-actions">
                  <button className="ghost-button" onClick={() => startEdit(task)} type="button">
                    Edit
                  </button>
                  <button
                    className="ghost-button"
                    disabled={activeTaskId === task.id}
                    onClick={() => void mutateTask(task.id, "toggle")}
                    type="button"
                  >
                    {task.completed ? "Mark active" : "Mark done"}
                  </button>
                  <button
                    className="ghost-button"
                    disabled={activeTaskId === task.id}
                    onClick={() => void mutateTask(task.id, "sync")}
                    type="button"
                  >
                    Retry sync
                  </button>
                  <button
                    className="secondary-button"
                    disabled={activeTaskId === task.id}
                    onClick={() => void mutateTask(task.id, "delete")}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function SetupItem({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="setup-item" data-ready={ready}>
      <span className="setup-item-dot" />
      <span>{label}</span>
    </div>
  );
}
