"use client";

import Image from "next/image";
import { ChangeEvent, FormEvent, useEffect, useState, useTransition } from "react";
import type { RegisteredMember, TaskRecord, TaskTaxonomy, TaxonomyKind } from "@/types/task";

type GoogleStatus = {
  configured: boolean;
  connected: boolean;
  ok: boolean;
};

type TasksResponse = {
  ok: boolean;
  tasks: TaskRecord[];
};

type TaxonomyResponse = {
  ok: boolean;
  taxonomy: TaskTaxonomy;
  error?: string;
};

type MembersResponse = {
  ok: boolean;
  members: RegisteredMember[];
  error?: string;
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
  error?: string;
};

type BackupResponse = {
  ok: boolean;
  backup?: {
    version: 1;
    exportedAt: string;
    tasks: TaskRecord[];
    taxonomy?: TaskTaxonomy;
  };
  error?: string;
};

const syncLabels = {
  synced: "連携済み",
  not_connected: "Google未連携",
  missing_config: "設定不足",
  failed: "連携エラー",
  disabled: "追加しない"
} as const;

const emptyForm = {
  title: "",
  dueDate: "",
  endDate: "",
  syncToCalendar: true,
  syncToTasks: true,
  reminderHoursBefore: "",
  dailyReminderHour: "",
  notes: "",
  projectName: "",
  categoryName: "",
  memberEmails: [] as string[]
};

const reminderHourOptions = [
  { value: "", label: "なし" },
  { value: "1", label: "1時間前" },
  { value: "3", label: "3時間前" },
  { value: "6", label: "6時間前" },
  { value: "12", label: "12時間前" },
  { value: "24", label: "24時間前" },
  { value: "48", label: "2日前" },
  { value: "72", label: "3日前" }
];

const dailyReminderOptions = [
  { value: "", label: "なし" },
  { value: "8", label: "08:00" },
  { value: "12", label: "12:00" },
  { value: "18", label: "18:00" },
  { value: "20", label: "20:00" },
  { value: "21", label: "21:00" }
];

const emptyTaxonomy: TaskTaxonomy = {
  projects: [],
  categories: []
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

async function readApiJson<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!text) {
    throw new Error("サーバーから空の応答が返りました。");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("サーバー応答を読み取れませんでした。");
  }
}

function getApiErrorMessage(result: unknown, fallback: string) {
  if (result && typeof result === "object" && "error" in result) {
    const candidate = result as { error?: unknown };

    if (typeof candidate.error === "string" && candidate.error) {
      return candidate.error;
    }
  }

  return fallback;
}

function toApiDateValue(value: string) {
  if (!value) {
    return "";
  }

  return value;
}

function toDateInputValue(value: string | null) {
  if (!value) {
    return "";
  }

  if (!value.includes("T")) {
    return value;
  }

  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 10);
}

function getProjectMembers(projectName: string, members: RegisteredMember[]) {
  if (!projectName) {
    return members;
  }

  return members.filter((member) => member.projectNames.includes(projectName));
}

function syncSelectedMembers(projectName: string, members: RegisteredMember[], selectedEmails: string[]) {
  if (!projectName) {
    return selectedEmails;
  }

  const allowedEmails = new Set(getProjectMembers(projectName, members).map((member) => member.email));
  return selectedEmails.filter((email) => allowedEmails.has(email));
}

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
  const [taxonomy, setTaxonomy] = useState<TaskTaxonomy>(emptyTaxonomy);
  const [members, setMembers] = useState<RegisteredMember[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberProjects, setNewMemberProjects] = useState<string[]>([]);
  const [editingMemberEmail, setEditingMemberEmail] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
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
  const [isManagingDirectory, startDirectoryTransition] = useTransition();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  useEffect(() => {
    void refreshStatus();
    void refreshTasks();
    void refreshSettings();
    void refreshSettingsHealth();
    void refreshTaxonomy();
    void refreshMembers();

    if (shouldCleanQuery) {
      window.history.replaceState({}, "", "/");
    }
  }, [shouldCleanQuery]);

  async function refreshStatus() {
    const response = await fetch("/api/google/status", { cache: "no-store" });
    const result = await readApiJson<GoogleStatus>(response);
    setGoogleStatus(result);
  }

  async function refreshTasks() {
    startLoadingTransition(async () => {
      const response = await fetch("/api/tasks", { cache: "no-store" });
      const result = await readApiJson<TasksResponse>(response);
      setTasks(result.tasks);
    });
  }

  async function refreshTaxonomy() {
    const response = await fetch("/api/taxonomy", { cache: "no-store" });
    const result = await readApiJson<TaxonomyResponse>(response);
    setTaxonomy(result.taxonomy);
  }

  async function refreshMembers() {
    const response = await fetch("/api/members", { cache: "no-store" });
    const result = await readApiJson<MembersResponse>(response);
    setMembers(result.members);
  }

  async function refreshSettings() {
    const response = await fetch("/api/settings", { cache: "no-store" });
    const result = await readApiJson<SettingsResponse>(response);

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
    const result = await readApiJson<SettingsHealthResponse>(response);
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
            title: form.title,
            dueDate: toApiDateValue(form.dueDate),
            endDate: toApiDateValue(form.endDate),
            syncToCalendar: form.syncToCalendar,
            syncToTasks: form.syncToTasks,
            reminderHoursBefore: form.reminderHoursBefore ? Number(form.reminderHoursBefore) : undefined,
            dailyReminderHour: form.dailyReminderHour ? Number(form.dailyReminderHour) : undefined,
            notes: form.notes,
            projectName: form.projectName.trim(),
            categoryName: form.categoryName.trim(),
            memberEmails: form.memberEmails,
            completed: editingTaskId
              ? tasks.find((task) => task.id === editingTaskId)?.completed ?? false
              : undefined
          })
        });

        const result = await readApiJson<TaskMutationResponse>(response);

        if (!response.ok || !result.task) {
          throw new Error(result.error ?? "タスクを保存できませんでした。");
        }

        const savedTask = result.task;

        if (editingTaskId) {
          setTasks((current) => current.map((task) => (task.id === savedTask.id ? savedTask : task)));
          setMessage("タスクを更新しました。");
        } else {
          setTasks((current) => [savedTask, ...current]);
          setMessage("タスクを登録しました。");
        }

        setForm(emptyForm);
        setEditingTaskId(null);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "タスクを保存できませんでした。");
      }
    });
  }

  async function handleDisconnect() {
    startDisconnectTransition(async () => {
      await fetch("/api/google/disconnect", { method: "POST" });
      await refreshStatus();
      setMessage("Google連携を解除しました。");
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

        const result = await readApiJson<SettingsResponse | { ok: false; error?: string }>(response);

        if (!response.ok || !("config" in result)) {
          throw new Error(getApiErrorMessage(result, "設定を保存できませんでした。"));
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
        setMessage("連携設定を保存しました。");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "設定を保存できませんでした。");
      }
    });
  }

  async function handleTaxonomyCreate(kind: TaxonomyKind) {
    const name = (kind === "project" ? newProjectName : newCategoryName).trim();

    if (!name) {
      setMessage(kind === "project" ? "プロジェクト名を入力してください。" : "カテゴリー名を入力してください。");
      return;
    }

    startDirectoryTransition(async () => {
      try {
        const response = await fetch("/api/taxonomy", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ kind, name })
        });

        const result = await readApiJson<TaxonomyResponse>(response);

        if (!response.ok) {
          throw new Error(result.error ?? "保存できませんでした。");
        }

        setTaxonomy(result.taxonomy);

        if (kind === "project") {
          setNewProjectName("");
          setForm((current) => ({ ...current, projectName: name }));
          setMessage("プロジェクトフォルダを追加しました。");
        } else {
          setNewCategoryName("");
          setForm((current) => ({ ...current, categoryName: name }));
          setMessage("カテゴリーを追加しました。");
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "保存できませんでした。");
      }
    });
  }

  async function handleMemberCreate() {
    const name = newMemberName.trim();
    const email = newMemberEmail.trim();

    if (!name || !email) {
      setMessage("メンバー名とGoogleアカウントのメールアドレスを入力してください。");
      return;
    }

    startDirectoryTransition(async () => {
      try {
        const response = await fetch("/api/members", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            name,
            email,
            projectNames: newMemberProjects
          })
        });

        const result = await readApiJson<MembersResponse>(response);

        if (!response.ok) {
          throw new Error(result.error ?? "メンバーを登録できませんでした。");
        }

        setMembers(result.members);
        setNewMemberName("");
        setNewMemberEmail("");
        setNewMemberProjects([]);
        setMessage("参加メンバーを登録しました。");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "メンバーを登録できませんでした。");
      }
    });
  }

  function resetMemberEditor() {
    setNewMemberName("");
    setNewMemberEmail("");
    setNewMemberProjects([]);
    setEditingMemberEmail(null);
  }

  async function handleMemberSave() {
    if (editingMemberEmail) {
      const name = newMemberName.trim();

      if (!name || !newMemberEmail.trim()) {
        setMessage("メンバー名とGoogleアカウントのメールアドレスを入力してください。");
        return;
      }

      startDirectoryTransition(async () => {
        try {
          const response = await fetch(`/api/members/${encodeURIComponent(editingMemberEmail)}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              name,
              projectNames: newMemberProjects
            })
          });

          const result = await readApiJson<MembersResponse>(response);

          if (!response.ok) {
            throw new Error(result.error ?? "メンバーを保存できませんでした。");
          }

          setMembers(result.members);
          setForm((current) => ({
            ...current,
            memberEmails: syncSelectedMembers(current.projectName, result.members, current.memberEmails)
          }));
          resetMemberEditor();
          setMessage("参加メンバーを更新しました。");
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "メンバーを保存できませんでした。");
        }
      });
      return;
    }

    await handleMemberCreate();
  }

  function startMemberEdit(member: RegisteredMember) {
    setEditingMemberEmail(member.email);
    setNewMemberName(member.name);
    setNewMemberEmail(member.email);
    setNewMemberProjects(member.projectNames);
    setMessage("参加メンバーを編集中です。");
  }

  function cancelMemberEdit() {
    resetMemberEditor();
    setMessage("参加メンバーの編集をキャンセルしました。");
  }

  async function handleMemberDelete(email: string) {
    startDirectoryTransition(async () => {
      try {
        const response = await fetch(`/api/members/${encodeURIComponent(email)}`, {
          method: "DELETE"
        });
        const result = await readApiJson<MembersResponse>(response);

        if (!response.ok) {
          throw new Error(result.error ?? "メンバーを削除できませんでした。");
        }

        setMembers(result.members);
        setForm((current) => ({
          ...current,
          memberEmails: current.memberEmails.filter((memberEmail) => memberEmail !== email)
        }));

        if (editingMemberEmail === email) {
          resetMemberEditor();
        }

        setMessage("参加メンバーを削除しました。");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "メンバーを削除できませんでした。");
      }
    });
  }

  function startEdit(task: TaskRecord) {
    setEditingTaskId(task.id);
    setForm({
      title: task.title,
      dueDate: toDateInputValue(task.dueDate),
      endDate: toDateInputValue(task.endDate),
      syncToCalendar: task.syncToCalendar,
      syncToTasks: task.syncToTasks,
      reminderHoursBefore:
        task.reminderHoursBefore === null || task.reminderHoursBefore === undefined
          ? ""
          : String(task.reminderHoursBefore),
      dailyReminderHour:
        task.dailyReminderHour === null || task.dailyReminderHour === undefined
          ? ""
          : String(task.dailyReminderHour),
      notes: task.notes,
      projectName: task.projectName ?? "",
      categoryName: task.categoryName ?? "",
      memberEmails: task.memberEmails ?? []
    });
    setMessage(`「${task.title}」を編集中です。`);
  }

  function cancelEdit() {
    setEditingTaskId(null);
    setForm(emptyForm);
    setMessage("編集をキャンセルしました。");
  }

  async function mutateTask(taskId: string, action: "sync" | "toggle" | "delete") {
    setActiveTaskId(taskId);
    setMessage("");

    try {
      if (action === "delete") {
        const response = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });

        if (!response.ok) {
          const result = await readApiJson<TaskMutationResponse>(response);
          throw new Error(result.error ?? "タスクを削除できませんでした。");
        }

        setTasks((current) => current.filter((task) => task.id !== taskId));

        if (editingTaskId === taskId) {
          setEditingTaskId(null);
          setForm(emptyForm);
        }

        setMessage("タスクを削除しました。");
        return;
      }

      const targetTask = tasks.find((task) => task.id === taskId);

      if (!targetTask) {
        throw new Error("タスクが見つかりません。");
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
                  endDate: targetTask.endDate ?? targetTask.dueDate ?? "",
                  syncToCalendar: targetTask.syncToCalendar,
                  syncToTasks: targetTask.syncToTasks,
                  reminderHoursBefore: targetTask.reminderHoursBefore ?? undefined,
                  dailyReminderHour: targetTask.dailyReminderHour ?? undefined,
                  notes: targetTask.notes,
                  projectName: targetTask.projectName ?? "",
                  categoryName: targetTask.categoryName ?? "",
                  memberEmails: targetTask.memberEmails ?? [],
                  completed: !targetTask.completed
                })
              : undefined
        }
      );

      const result = await readApiJson<TaskMutationResponse>(response);

      if (!response.ok || !result.task) {
        throw new Error(result.error ?? "タスク操作に失敗しました。");
      }

      const updatedTask = result.task;
      setTasks((current) => current.map((task) => (task.id === updatedTask.id ? updatedTask : task)));
      setMessage(
        action === "sync"
          ? "Google連携を再実行しました。"
          : updatedTask.completed
            ? "タスクを完了にしました。"
            : "タスクを進行中に戻しました。"
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "タスク操作に失敗しました。");
    } finally {
      setActiveTaskId(null);
    }
  }

  async function handleBulkSync() {
    startBulkSyncTransition(async () => {
      setMessage("");

      try {
        const response = await fetch("/api/tasks/sync", { method: "POST" });
        const result = await readApiJson<BulkSyncResponse>(response);

        if (!response.ok) {
          throw new Error(result.error ?? "一括再連携に失敗しました。");
        }

        if (result.tasks.length === 0) {
          setMessage("再連携が必要なタスクはありません。");
          return;
        }

        const nextTasks = new Map(result.tasks.map((task) => [task.id, task]));
        setTasks((current) => current.map((task) => nextTasks.get(task.id) ?? task));
        setMessage(`${result.tasks.length}件のタスクを再連携しました。`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "一括再連携に失敗しました。");
      }
    });
  }

  async function handleExportBackup() {
    startExportTransition(async () => {
      setMessage("");

      try {
        const response = await fetch("/api/backup", { cache: "no-store" });
        const result = await readApiJson<BackupResponse>(response);

        if (!response.ok || !result.backup) {
          throw new Error(result.error ?? "バックアップを書き出せませんでした。");
        }

        const blob = new Blob([JSON.stringify(result.backup, null, 2)], {
          type: "application/json"
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const stamp = new Date(result.backup.exportedAt).toISOString().replaceAll(":", "-");

        link.href = url;
        link.download = `todokun-backup-${stamp}.json`;
        link.click();
        URL.revokeObjectURL(url);
        setMessage("バックアップを書き出しました。");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "バックアップを書き出せませんでした。");
      }
    });
  }

  async function handleImportBackup(event: ChangeEvent<HTMLInputElement>) {
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

        const result = await readApiJson<BulkSyncResponse & { error?: string }>(response);

        if (!response.ok) {
          throw new Error(result.error ?? "バックアップの読み込みに失敗しました。");
        }

        setTasks(result.tasks);
        await refreshTaxonomy();
        await refreshMembers();
        setMessage("バックアップを読み込みました。");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "バックアップの読み込みに失敗しました。");
      } finally {
        event.target.value = "";
      }
    });
  }

  function handleProjectSelect(projectName: string) {
    setForm((current) => ({
      ...current,
      projectName,
      memberEmails: syncSelectedMembers(projectName, members, current.memberEmails)
    }));
  }

  function toggleFormMember(email: string) {
    setForm((current) => ({
      ...current,
      memberEmails: current.memberEmails.includes(email)
        ? current.memberEmails.filter((item) => item !== email)
        : [...current.memberEmails, email]
    }));
  }

  function toggleNewMemberProject(projectName: string) {
    setNewMemberProjects((current) =>
      current.includes(projectName)
        ? current.filter((item) => item !== projectName)
        : [...current, projectName]
    );
  }

  const visibleTasks = tasks.filter((task) => {
    if (filter === "open" && task.completed) {
      return false;
    }

    if (filter === "done" && !task.completed) {
      return false;
    }

    if (projectFilter !== "all" && (task.projectName || "") !== projectFilter) {
      return false;
    }

    if (categoryFilter !== "all" && (task.categoryName || "") !== categoryFilter) {
      return false;
    }

    return true;
  });

  const taskSummary = {
    total: tasks.length,
    open: tasks.filter((task) => !task.completed).length,
    projects: taxonomy.projects.length,
    categories: taxonomy.categories.length
  };

  const availableMembers = getProjectMembers(form.projectName, members);

  return (
    <main className="page-shell">
      <div className="app-layout">
        <aside className="sidebar-card">
          <div className="brand-chip">タスク管理アプリ「トドくん」</div>
          <div className="sidebar-mascot">
            <Image
              alt="トドくんのイメージキャラクター"
              className="mascot-image"
              height={220}
              priority
              src="/todokun.png"
              width={220}
            />
          </div>
          <div className="status-pill">
            <span className="status-dot" data-active={googleStatus.connected} />
            <span>
              {googleStatus.connected
                ? "Google 連携中"
                : googleStatus.configured
                  ? "Google 連携の準備完了"
                  : "Google 設定が未完了"}
            </span>
          </div>
          <nav className="sidebar-nav" aria-label="ページメニュー">
            <a href="#task-create">タスク作成</a>
            <a href="#sync-settings">連携設定</a>
            <a href="#project-manager">プロジェクト管理</a>
            <a href="#category-manager">種類管理</a>
            <a href="#member-directory">参加メンバー</a>
            <a href="#setup-check">はじめの連携チェック</a>
            <a href="#task-summary">サマリー</a>
            <a href="#task-list">タスク一覧</a>
          </nav>
          <div className="action-row sidebar-actions">
            {googleStatus.connected ? (
              <button
                className="secondary-button"
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                type="button"
              >
                {isDisconnecting ? "解除中..." : "Google 連携を解除"}
              </button>
            ) : (
              <a className="primary-link" href="/api/google/connect">
                Google とつなぐ
              </a>
            )}
          </div>
        </aside>

        <div className="content-stack">
      <section className="content-grid task-top-section" id="task-create">
        <form className="task-card" onSubmit={handleSubmit}>
          <div className="section-heading">
            <h2>{editingTaskId ? "タスクを編集" : "タスクを登録"}</h2>
            <p>最初に見えるのはこの登録画面だけです。ほかの機能は左のメニューから移動できます。</p>
          </div>

          <label>
            タスク名
            <input
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="例: 補助金資料の最終確認"
              required
            />
          </label>

          <div className="field-grid">
            <label>
              プロジェクトフォルダ
              <select value={form.projectName} onChange={(event) => handleProjectSelect(event.target.value)}>
                <option value="">未設定</option>
                {taxonomy.projects.map((project) => (
                  <option key={project} value={project}>
                    {project}
                  </option>
                ))}
              </select>
            </label>

            <label>
              タスクの種類
              <select
                value={form.categoryName}
                onChange={(event) =>
                  setForm((current) => ({ ...current, categoryName: event.target.value }))
                }
              >
                <option value="">未設定</option>
                {taxonomy.categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            期限
            <input
              type="date"
              value={form.dueDate}
              onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))}
            />
          </label>

          <div className="task-chip-row">
            <label className="member-option">
              <input
                checked={form.syncToCalendar}
                disabled={Boolean(editingTaskId)}
                onChange={(event) =>
                  setForm((current) => ({ ...current, syncToCalendar: event.target.checked }))
                }
                type="checkbox"
              />
              <div>
                <strong>Google カレンダーに追加する</strong>
                <span>オフにするとアプリ内だけに保存されます</span>
              </div>
            </label>
            <label className="member-option">
              <input
                checked={form.syncToTasks}
                disabled={Boolean(editingTaskId)}
                onChange={(event) =>
                  setForm((current) => ({ ...current, syncToTasks: event.target.checked }))
                }
                type="checkbox"
              />
              <div>
                <strong>Google To Do に追加する</strong>
                <span>オフにすると To Do には登録されません</span>
              </div>
            </label>
          </div>

          {editingTaskId ? (
            <p className="member-picker-empty">連携先の変更は新規登録時に選べます。編集では現在の設定を維持します。</p>
          ) : null}

          <label>
            終了日の何時間前に通知
            <select
              value={form.reminderHoursBefore}
              disabled={!form.syncToCalendar}
              onChange={(event) =>
                setForm((current) => ({ ...current, reminderHoursBefore: event.target.value }))
              }
            >
              {reminderHourOptions.map((option) => (
                <option key={option.value || "none"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            メモ
            <textarea
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="補足や次のアクションを書けます"
              rows={4}
            />
          </label>

          <label>
            終了日
            <input
              type="date"
              value={form.endDate}
              min={form.dueDate || undefined}
              onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))}
            />
          </label>

          <label>
            毎日リマインドする時刻
            <select
              value={form.dailyReminderHour}
              disabled={!form.syncToCalendar}
              onChange={(event) =>
                setForm((current) => ({ ...current, dailyReminderHour: event.target.value }))
              }
            >
              {dailyReminderOptions.map((option) => (
                <option key={option.value || "none"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="member-picker">
            <div className="member-picker-header">
              <strong>参加メンバー</strong>
              <span>
                {form.projectName
                  ? `選択中のプロジェクト: ${form.projectName}`
                  : "プロジェクト未選択のため全メンバーを表示中"}
              </span>
            </div>
            {availableMembers.length === 0 ? (
              <p className="member-picker-empty">
                {form.projectName
                  ? "このプロジェクトに登録されたメンバーがまだいません。下のメンバー管理から追加できます。"
                  : "登録済みメンバーがまだいません。下のメンバー管理から追加できます。"}
              </p>
            ) : (
              <div className="member-checklist">
                {availableMembers.map((member) => (
                  <label className="member-option" key={member.email}>
                    <input
                      checked={form.memberEmails.includes(member.email)}
                      onChange={() => toggleFormMember(member.email)}
                      type="checkbox"
                    />
                    <div>
                      <strong>{member.name}</strong>
                      <span>{member.email}</span>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="action-row">
            <button type="submit" disabled={isSaving}>
              {isSaving ? "保存中..." : editingTaskId ? "更新する" : "登録する"}
            </button>
            {editingTaskId ? (
              <button className="ghost-button" type="button" onClick={cancelEdit}>
                キャンセル
              </button>
            ) : null}
          </div>

          {message ? <p className="status-message">{message}</p> : null}
        </form>
        <aside className="info-card" id="sync-settings">
          <div className="section-heading">
            <h2>連携設定</h2>
            <p>最初に一度だけ設定すれば、その後はブラウザからそのまま使えます。</p>
          </div>
          <form className="settings-form" onSubmit={handleSettingsSave}>
            <label>
              Google Client ID
              <input
                value={settingsForm.googleClientId}
                onChange={(event) =>
                  setSettingsForm((current) => ({ ...current, googleClientId: event.target.value }))
                }
                placeholder="Google OAuth の Client ID"
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
                    ? "設定済みです。変更時だけ入力してください"
                    : "Google OAuth の Client Secret"
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
                    ? "設定済みです。変更時だけ入力してください"
                    : "アプリ暗号化用の秘密文字列"
                }
              />
            </label>
            <div className="settings-hints">
              <p>
                {settingsConfigured.appSecretConfigured
                  ? "App Secret は設定済みです。変更時だけ再入力してください。"
                  : "App Secret を設定すると、このブラウザから Google 連携を始められます。"}
              </p>
            </div>
            <button type="submit" disabled={isSavingSettings}>
              {isSavingSettings ? "設定を保存中..." : "設定を保存"}
            </button>
          </form>
        </aside>
      </section>

      <div className="deferred-sections">
      <section className="manager-grid">
        <article className="manager-card" id="project-manager">
          <div className="section-heading">
            <h2>プロジェクトフォルダ</h2>
            <p>案件ごとの箱を先に作っておくと、あとから迷わず登録できます。</p>
          </div>
          <div className="inline-form">
            <input
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              placeholder="例: 補助金申請 / 既存顧客対応"
            />
            <button disabled={isManagingDirectory} onClick={() => void handleTaxonomyCreate("project")} type="button">
              追加
            </button>
          </div>
          <div className="chip-list">
            {taxonomy.projects.length === 0 ? (
              <span className="empty-chip">まだプロジェクトはありません</span>
            ) : (
              taxonomy.projects.map((project) => (
                <button className="chip-button" key={project} onClick={() => handleProjectSelect(project)} type="button">
                  {project}
                </button>
              ))
            )}
          </div>
        </article>

        <article className="manager-card" id="category-manager">
          <div className="section-heading">
            <h2>タスクの種類</h2>
            <p>メール送信、アポ調整、資料作成のように、作業の種類でも整理できます。</p>
          </div>
          <div className="inline-form">
            <input
              value={newCategoryName}
              onChange={(event) => setNewCategoryName(event.target.value)}
              placeholder="例: 申請入力 / 電話確認 / 請求処理"
            />
            <button
              disabled={isManagingDirectory}
              onClick={() => void handleTaxonomyCreate("category")}
              type="button"
            >
              追加
            </button>
          </div>
          <div className="chip-list">
            {taxonomy.categories.map((category) => (
              <button
                className="chip-button"
                key={category}
                onClick={() => setForm((current) => ({ ...current, categoryName: category }))}
                type="button"
              >
                {category}
              </button>
            ))}
          </div>
        </article>

        <article className="manager-card manager-card-wide" id="member-directory">
          <div className="section-heading">
            <h2>参加メンバー名簿</h2>
            <p>Google アカウントのメールアドレスを先に登録しておくと、タスク登録時にチェックボックスで選べます。</p>
          </div>
          <div className="member-register-grid">
            <input
              value={newMemberName}
              onChange={(event) => setNewMemberName(event.target.value)}
              placeholder="メンバー名"
            />
            <input
              value={newMemberEmail}
              onChange={(event) => setNewMemberEmail(event.target.value)}
              disabled={Boolean(editingMemberEmail)}
              placeholder="Googleアカウントのメールアドレス"
            />
          </div>
          <div className="project-picker">
            <span>所属プロジェクト</span>
            <div className="project-picker-list">
              {taxonomy.projects.length === 0 ? (
                <span className="empty-chip">先にプロジェクトを追加してください</span>
              ) : (
                taxonomy.projects.map((project) => (
                  <label className="project-option" key={project}>
                    <input
                      checked={newMemberProjects.includes(project)}
                      onChange={() => toggleNewMemberProject(project)}
                      type="checkbox"
                    />
                    <span>{project}</span>
                  </label>
                ))
              )}
            </div>
          </div>
          <div className="action-row">
            <button disabled={isManagingDirectory} onClick={() => void handleMemberSave()} type="button">
              {editingMemberEmail ? "変更を保存" : "メンバーを登録"}
            </button>
            {editingMemberEmail ? (
              <button className="ghost-button" disabled={isManagingDirectory} onClick={cancelMemberEdit} type="button">
                キャンセル
              </button>
            ) : null}
          </div>
          <div className="member-directory">
            {members.length === 0 ? (
              <p className="member-picker-empty">まだメンバーは登録されていません。</p>
            ) : (
              members.map((member) => (
                <article className="member-directory-item" key={member.email}>
                  <div>
                    <strong>{member.name}</strong>
                    <span>{member.email}</span>
                  </div>
                  <div className="member-directory-body">
                    <div className="task-chip-row">
                      {member.projectNames.length === 0 ? (
                        <span className="empty-chip">未分類</span>
                      ) : (
                        member.projectNames.map((project) => (
                          <span className="task-chip" key={`${member.email}-${project}`}>
                            {project}
                          </span>
                        ))
                      )}
                    </div>
                    <div className="member-directory-actions">
                      <button
                        className="ghost-button"
                        disabled={isManagingDirectory}
                        onClick={() => startMemberEdit(member)}
                        type="button"
                      >
                        編集
                      </button>
                      <button
                        className="secondary-button"
                        disabled={isManagingDirectory}
                        onClick={() => void handleMemberDelete(member.email)}
                        type="button"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="setup-card" id="setup-check">
        <div className="section-heading">
          <h2>はじめの連携チェック</h2>
          <p>上から順にそろえると、ブラウザ上から Google 連携を始めやすくなります。</p>
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
            ? "このブラウザから Google 連携を始められます。"
            : "足りない項目を保存してから Google 連携を進めてください。"}
        </p>
      </section>

      <section className="stats-grid" aria-label="Task summary" id="task-summary">
        <article className="stat-card">
          <span className="stat-label">登録タスク</span>
          <strong>{taskSummary.total}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">進行中</span>
          <strong>{taskSummary.open}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">プロジェクト数</span>
          <strong>{taskSummary.projects}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">カテゴリー数</span>
          <strong>{taskSummary.categories}</strong>
        </article>
      </section>

      <section className="list-card" id="task-list">
        <div className="section-heading section-heading-row">
          <div>
            <h2>タスク一覧</h2>
            <p>プロジェクトや種類ごとに絞り込みながら、進み具合と Google 反映状況を確認できます。</p>
          </div>
          <div className="toolbar-row">
            <div className="filter-row" role="tablist" aria-label="タスクの状態">
              <button className="ghost-button" data-selected={filter === "all"} onClick={() => setFilter("all")} type="button">
                すべて
              </button>
              <button className="ghost-button" data-selected={filter === "open"} onClick={() => setFilter("open")} type="button">
                進行中
              </button>
              <button className="ghost-button" data-selected={filter === "done"} onClick={() => setFilter("done")} type="button">
                完了
              </button>
            </div>
            <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
              <option value="all">全プロジェクト</option>
              {taxonomy.projects.map((project) => (
                <option key={project} value={project}>
                  {project}
                </option>
              ))}
            </select>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="all">全カテゴリー</option>
              {taxonomy.categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <button className="ghost-button" disabled={isBulkSyncing} onClick={() => void handleBulkSync()} type="button">
              {isBulkSyncing ? "再連携中..." : "未連携をまとめて再実行"}
            </button>
            <button className="ghost-button" disabled={isExporting} onClick={() => void handleExportBackup()} type="button">
              {isExporting ? "書き出し中..." : "バックアップを書き出す"}
            </button>
            <label className="ghost-button file-button">
              {isImporting ? "読込中..." : "バックアップを読み込む"}
              <input
                accept="application/json"
                className="file-input"
                disabled={isImporting}
                onChange={(event) => void handleImportBackup(event)}
                type="file"
              />
            </label>
            <button className="ghost-button" onClick={() => void refreshTasks()} disabled={isLoading} type="button">
              {isLoading ? "更新中..." : "最新に更新"}
            </button>
          </div>
        </div>

        <div className="task-list">
          {visibleTasks.length === 0 ? (
            <div className="empty-state">
              <p>{tasks.length === 0 ? "まだタスクがありません。最初の1件を登録してみましょう。" : "この条件に合うタスクはありません。"}</p>
            </div>
          ) : (
            <div className="task-table" role="table" aria-label="タスク一覧">
              <div className="task-table-row task-table-head" role="row">
                <span role="columnheader">タスク名</span>
                <span role="columnheader">プロジェクト名</span>
                <span role="columnheader">期間</span>
                <span role="columnheader">参加者</span>
                <span role="columnheader">メモ</span>
                <span role="columnheader">操作</span>
              </div>

              {visibleTasks.map((task) => (
                <article className="task-table-row" data-completed={task.completed} key={task.id} role="row">
                  <div className="task-table-cell task-title-cell" data-label="タスク名" role="cell">
                    {task.title}
                  </div>
                  <div className="task-table-cell" data-label="プロジェクト名" role="cell">
                    {task.projectName || "未設定"}
                  </div>
                  <div className="task-table-cell" data-label="期間" role="cell">
                    {formatTaskPeriod(task)}
                  </div>
                  <div className="task-table-cell" data-label="参加者" role="cell">
                    {task.memberEmails.length > 0 ? task.memberEmails.join(" / ") : "未設定"}
                  </div>
                  <div className="task-table-cell task-note-cell" data-label="メモ" role="cell">
                    {task.notes || "メモはまだありません。"}
                  </div>
                  <div className="task-table-cell" data-label="操作" role="cell">
                    <div className="task-actions">
                      <button className="ghost-button" onClick={() => startEdit(task)} type="button">
                        編集
                      </button>
                      <button
                        className="ghost-button"
                        disabled={activeTaskId === task.id}
                        onClick={() => void mutateTask(task.id, "toggle")}
                        type="button"
                      >
                        {task.completed ? "戻す" : "完了"}
                      </button>
                      <button
                        className="ghost-button"
                        disabled={activeTaskId === task.id}
                        onClick={() => void mutateTask(task.id, "sync")}
                        type="button"
                      >
                        再連携
                      </button>
                      <button
                        className="secondary-button"
                        disabled={activeTaskId === task.id}
                        onClick={() => void mutateTask(task.id, "delete")}
                        type="button"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
      </div>
        </div>
      </div>
    </main>
  );
}

function formatDate(value: string) {
  if (!value.includes("T")) {
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(new Date(`${value}T00:00:00`));
  }

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatTaskPeriod(task: Pick<TaskRecord, "dueDate" | "endDate">) {
  if (!task.dueDate) {
    return "未設定";
  }

  if (!task.endDate || task.endDate === task.dueDate) {
    return formatDate(task.dueDate);
  }

  return `${formatDate(task.dueDate)}〜${formatDate(task.endDate)}`;
}

function formatReminderSummary(
  task: Pick<TaskRecord, "syncToCalendar" | "reminderHoursBefore" | "dailyReminderHour">
) {
  if (!task.syncToCalendar) {
    return "";
  }

  const labels: string[] = [];

  if (task.reminderHoursBefore !== null && task.reminderHoursBefore !== undefined) {
    labels.push(`終了${task.reminderHoursBefore}時間前`);
  }

  if (task.dailyReminderHour !== null && task.dailyReminderHour !== undefined) {
    labels.push(`毎日${String(task.dailyReminderHour).padStart(2, "0")}:00`);
  }

  return labels.join(" / ");
}

function SetupItem({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="setup-item" data-ready={ready}>
      <span className="setup-item-dot" />
      <span>{label}</span>
    </div>
  );
}
