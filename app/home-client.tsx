"use client";

import Image from "next/image";
import { ChangeEvent, FormEvent, useEffect, useState, useTransition } from "react";
import type { TaskRecord, TaskTaxonomy, TaxonomyKind } from "@/types/task";

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
  backup: {
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
  failed: "連携エラー"
} as const;

const emptyForm = {
  title: "",
  dueDate: "",
  notes: "",
  projectName: "",
  categoryName: "",
  memberEmailsText: ""
};

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

function toApiDateTime(value: string) {
  if (!value) {
    return "";
  }

  return new Date(value).toISOString();
}

function toDateTimeLocalValue(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
}

function parseMemberEmails(value: string) {
  return [...new Set(value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean))];
}

function toMemberEmailsText(memberEmails: string[]) {
  return memberEmails.join(", ");
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
  const [newProjectName, setNewProjectName] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
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
  const [isTaxonomySaving, startTaxonomyTransition] = useTransition();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  useEffect(() => {
    void refreshStatus();
    void refreshTasks();
    void refreshSettings();
    void refreshSettingsHealth();
    void refreshTaxonomy();

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
            ...form,
            projectName: form.projectName.trim(),
            categoryName: form.categoryName.trim(),
            memberEmails: parseMemberEmails(form.memberEmailsText),
            dueDate: toApiDateTime(form.dueDate),
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

        await refreshTaxonomy();
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

    startTaxonomyTransition(async () => {
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
        setMessage(error instanceof Error ? error.message : "追加できませんでした。");
      }
    });
  }

  function startEdit(task: TaskRecord) {
    setEditingTaskId(task.id);
    setForm({
      title: task.title,
      dueDate: toDateTimeLocalValue(task.dueDate),
      notes: task.notes,
      projectName: task.projectName ?? "",
      categoryName: task.categoryName ?? "",
      memberEmailsText: toMemberEmailsText(task.memberEmails ?? [])
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
        setMessage("バックアップを読み込みました。");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "バックアップの読み込みに失敗しました。");
      } finally {
        event.target.value = "";
      }
    });
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

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div className="hero-copy">
          <div className="brand-chip">タスク管理アプリ「トドくん」</div>
          <h1>プロジェクトごとに整理して、やることをトドける。</h1>
          <p className="lead">
            トドくんは、ブラウザだけで使えるやさしいタスク管理アプリです。プロジェクトフォルダを作って、
            タスクの種類も分類しながら、Google カレンダーと Google To Do に自動で反映できます。
          </p>
          <div className="hero-points" aria-label="アプリの特徴">
            <div className="hero-point">プロジェクト整理</div>
            <div className="hero-point">カテゴリー追加</div>
            <div className="hero-point">Google 自動連携</div>
          </div>
        </div>

        <div className="hero-visual">
          <div className="mascot-card">
            <Image
              alt="トドくんのイメージキャラクター"
              className="mascot-image"
              height={360}
              priority
              src="/todokun.png"
              width={360}
            />
            <div className="mascot-bubble">
              <strong>今日のひとこと</strong>
              <p>案件ごとでも作業の種類ごとでも、見失わないようにトドくんが整理します。</p>
            </div>
          </div>
          <div className="hero-status">
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

            <div className="action-row">
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
          </div>
        </div>
      </section>

      <section className="content-grid">
        <form className="task-card" onSubmit={handleSubmit}>
          <div className="section-heading">
            <h2>{editingTaskId ? "タスクを編集" : "タスクを登録"}</h2>
            <p>登録した内容は、Google 連携済みならカレンダーと To Do に自動反映されます。</p>
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
              <select
                value={form.projectName}
                onChange={(event) =>
                  setForm((current) => ({ ...current, projectName: event.target.value }))
                }
              >
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
              type="datetime-local"
              value={form.dueDate}
              onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))}
            />
          </label>

          <label>
            メモ
            <textarea
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="補足や次のアクションを書けます"
              rows={5}
            />
          </label>

          <label>
            参加メンバー
            <textarea
              value={form.memberEmailsText}
              onChange={(event) =>
                setForm((current) => ({ ...current, memberEmailsText: event.target.value }))
              }
              placeholder="Googleアカウントのメールアドレスをカンマ区切りか改行で追加"
              rows={3}
            />
          </label>

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

        <aside className="info-card">
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

      <section className="manager-grid">
        <article className="manager-card">
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
            <button
              disabled={isTaxonomySaving}
              onClick={() => void handleTaxonomyCreate("project")}
              type="button"
            >
              追加
            </button>
          </div>
          <div className="chip-list">
            {taxonomy.projects.length === 0 ? (
              <span className="empty-chip">まだプロジェクトはありません</span>
            ) : (
              taxonomy.projects.map((project) => (
                <button
                  className="chip-button"
                  key={project}
                  onClick={() => setForm((current) => ({ ...current, projectName: project }))}
                  type="button"
                >
                  {project}
                </button>
              ))
            )}
          </div>
        </article>

        <article className="manager-card">
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
              disabled={isTaxonomySaving}
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
      </section>

      <section className="setup-card">
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

      <section className="stats-grid" aria-label="Task summary">
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

      <section className="list-card">
        <div className="section-heading section-heading-row">
          <div>
            <h2>タスク一覧</h2>
            <p>プロジェクトや種類ごとに絞り込みながら、進み具合と Google 反映状況を確認できます。</p>
          </div>
          <div className="toolbar-row">
            <div className="filter-row" role="tablist" aria-label="タスクの状態">
              <button
                className="ghost-button"
                data-selected={filter === "all"}
                onClick={() => setFilter("all")}
                type="button"
              >
                すべて
              </button>
              <button
                className="ghost-button"
                data-selected={filter === "open"}
                onClick={() => setFilter("open")}
                type="button"
              >
                進行中
              </button>
              <button
                className="ghost-button"
                data-selected={filter === "done"}
                onClick={() => setFilter("done")}
                type="button"
              >
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
            <button
              className="ghost-button"
              disabled={isBulkSyncing}
              onClick={() => void handleBulkSync()}
              type="button"
            >
              {isBulkSyncing ? "再連携中..." : "未連携をまとめて再実行"}
            </button>
            <button
              className="ghost-button"
              disabled={isExporting}
              onClick={() => void handleExportBackup()}
              type="button"
            >
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
            <button
              className="ghost-button"
              onClick={() => void refreshTasks()}
              disabled={isLoading}
              type="button"
            >
              {isLoading ? "更新中..." : "最新に更新"}
            </button>
          </div>
        </div>

        <div className="task-list">
          {visibleTasks.length === 0 ? (
            <div className="empty-state">
              <p>
                {tasks.length === 0
                  ? "まだタスクがありません。最初の1件を登録してみましょう。"
                  : "この条件に合うタスクはありません。"}
              </p>
            </div>
          ) : (
            visibleTasks.map((task) => (
              <article className="task-item" data-completed={task.completed} key={task.id}>
                <div className="task-main">
                  <div className="task-title-row">
                    <h3>{task.title}</h3>
                    <span className="task-badge">{task.completed ? "完了" : "進行中"}</span>
                  </div>
                  <div className="task-chip-row">
                    {task.projectName ? <span className="task-chip">案件: {task.projectName}</span> : null}
                    {task.categoryName ? (
                      <span className="task-chip">種類: {task.categoryName}</span>
                    ) : null}
                    {task.memberEmails.map((email) => (
                      <span className="task-chip" key={email}>
                        参加: {email}
                      </span>
                    ))}
                  </div>
                  <p>{task.notes || "メモはまだありません。"}</p>
                </div>

                <dl className="task-meta">
                  <div>
                    <dt>期限</dt>
                    <dd>{task.dueDate ? formatDate(task.dueDate) : "未設定"}</dd>
                  </div>
                  <div>
                    <dt>カレンダー</dt>
                    <dd>{syncLabels[task.calendarSync]}</dd>
                  </div>
                  <div>
                    <dt>To Do</dt>
                    <dd>{syncLabels[task.tasksSync]}</dd>
                  </div>
                  <div>
                    <dt>参加人数</dt>
                    <dd>{task.memberEmails.length}人</dd>
                  </div>
                </dl>

                <div className="sync-details">
                  <p>
                    <strong>カレンダー:</strong> {task.calendarSyncMessage}
                  </p>
                  <p>
                    <strong>To Do:</strong> {task.tasksSyncMessage}
                  </p>
                  <p>
                    <strong>最終連携:</strong>{" "}
                    {task.lastSyncAttemptedAt ? formatDate(task.lastSyncAttemptedAt) : "まだ実行されていません"}
                  </p>
                </div>

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
                    {task.completed ? "進行中に戻す" : "完了にする"}
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
