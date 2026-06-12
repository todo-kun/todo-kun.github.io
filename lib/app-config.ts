import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readJsonFile, writeJsonFile } from "@/lib/file-store";
import { decryptJson, encryptJson } from "@/lib/crypto";

const appConfigFileName = "app-config.json";
const appConfigCookieName = "todokun_app_config_v2";

export type AppConfig = {
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  googleCalendarId: string;
  googleTasksListId: string;
  appUrl: string;
  appSecret: string;
};

export type PublicAppConfig = Omit<AppConfig, "googleClientSecret" | "appSecret"> & {
  googleClientSecretConfigured: boolean;
  appSecretConfigured: boolean;
};

export type AppConfigHealth = {
  googleClientId: boolean;
  googleClientSecret: boolean;
  googleRedirectUri: boolean;
  googleCalendarId: boolean;
  googleTasksListId: boolean;
  appUrl: boolean;
  appSecret: boolean;
  readyForGoogleConnect: boolean;
};

const emptyConfig: AppConfig = {
  googleClientId: "",
  googleClientSecret: "",
  googleRedirectUri: "",
  googleCalendarId: "primary",
  googleTasksListId: "@default",
  appUrl: "http://localhost:3000",
  appSecret: ""
};

function shouldUseCookieConfig() {
  return process.env.APP_CONFIG_PROVIDER === "cookie" || process.env.NODE_ENV === "production";
}

function getCookieEncryptionSecret() {
  return process.env.APP_SECRET ?? "";
}

async function readCookieConfig(): Promise<Partial<AppConfig>> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get(appConfigCookieName)?.value;

    if (!raw) {
      return {};
    }

    const secret = getCookieEncryptionSecret();

    if (!secret) {
      return {};
    }

    return decryptJson<Partial<AppConfig>>(raw, secret);
  } catch {
    return {};
  }
}

export async function getAppConfig(): Promise<AppConfig> {
  const saved = shouldUseCookieConfig()
    ? await readCookieConfig()
    : await readJsonFile<Partial<AppConfig>>(appConfigFileName, {});

  return {
    googleClientId: saved.googleClientId ?? process.env.GOOGLE_CLIENT_ID ?? emptyConfig.googleClientId,
    googleClientSecret:
      process.env.GOOGLE_CLIENT_SECRET ?? emptyConfig.googleClientSecret,
    googleRedirectUri:
      saved.googleRedirectUri ?? process.env.GOOGLE_REDIRECT_URI ?? emptyConfig.googleRedirectUri,
    googleCalendarId:
      saved.googleCalendarId ?? process.env.GOOGLE_CALENDAR_ID ?? emptyConfig.googleCalendarId,
    googleTasksListId:
      saved.googleTasksListId ?? process.env.GOOGLE_TASKS_LIST_ID ?? emptyConfig.googleTasksListId,
    appUrl: saved.appUrl ?? process.env.APP_URL ?? emptyConfig.appUrl,
    appSecret: process.env.APP_SECRET ?? emptyConfig.appSecret
  };
}

export async function getPublicAppConfig(): Promise<PublicAppConfig> {
  const config = await getAppConfig();

  return {
    googleClientId: config.googleClientId,
    googleRedirectUri: config.googleRedirectUri,
    googleCalendarId: config.googleCalendarId,
    googleTasksListId: config.googleTasksListId,
    appUrl: config.appUrl,
    googleClientSecretConfigured: Boolean(config.googleClientSecret),
    appSecretConfigured: Boolean(config.appSecret)
  };
}

export async function saveAppConfig(input: Partial<AppConfig>) {
  const current = await getAppConfig();
  const nextAppSecret = shouldUseCookieConfig()
    ? process.env.APP_SECRET || ""
    : input.appSecret || current.appSecret || generateAppSecret();
  const next: AppConfig = {
    ...current,
    ...input,
    googleClientSecret: shouldUseCookieConfig()
      ? current.googleClientSecret
      : input.googleClientSecret
        ? input.googleClientSecret
        : current.googleClientSecret,
    appSecret: nextAppSecret
  };

  if (shouldUseCookieConfig()) {
    if (!getCookieEncryptionSecret()) {
      throw new Error("Set APP_SECRET in Vercel before saving settings in production.");
    }

    return {
      config: getPublicConfigFromValue(next),
      fullConfig: next
    };
  }

  await writeJsonFile(appConfigFileName, next);
  return {
    config: getPublicConfigFromValue(next),
    fullConfig: next
  };
}

export function attachAppConfigCookie(response: NextResponse, config: AppConfig) {
  if (!shouldUseCookieConfig()) {
    return;
  }

  const secret = getCookieEncryptionSecret();

  if (!secret) {
    throw new Error("Set APP_SECRET in Vercel before saving settings in production.");
  }

  response.cookies.set(
    appConfigCookieName,
    encryptJson(
      {
        googleClientId: config.googleClientId,
        googleRedirectUri: config.googleRedirectUri,
        googleCalendarId: config.googleCalendarId,
        googleTasksListId: config.googleTasksListId,
        appUrl: config.appUrl
      },
      secret
    ),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30
    }
  );
}

function getPublicConfigFromValue(config: AppConfig): PublicAppConfig {
  return {
    googleClientId: config.googleClientId,
    googleRedirectUri: config.googleRedirectUri,
    googleCalendarId: config.googleCalendarId,
    googleTasksListId: config.googleTasksListId,
    appUrl: config.appUrl,
    googleClientSecretConfigured: Boolean(config.googleClientSecret),
    appSecretConfigured: Boolean(config.appSecret)
  };
}

export async function hasAppConfig() {
  const health = await getAppConfigHealth();

  return health.readyForGoogleConnect;
}

export async function getAppConfigHealth(): Promise<AppConfigHealth> {
  const config = await getAppConfig();

  const health: AppConfigHealth = {
    googleClientId: Boolean(config.googleClientId),
    googleClientSecret: Boolean(config.googleClientSecret),
    googleRedirectUri: Boolean(config.googleRedirectUri),
    googleCalendarId: Boolean(config.googleCalendarId),
    googleTasksListId: Boolean(config.googleTasksListId),
    appUrl: Boolean(config.appUrl),
    appSecret: Boolean(config.appSecret),
    readyForGoogleConnect: false
  };

  health.readyForGoogleConnect = Boolean(
    health.googleClientId &&
      health.googleClientSecret &&
      health.googleRedirectUri &&
      health.appSecret
  );

  return health;
}

export function generateAppSecret() {
  return randomBytes(32).toString("base64url");
}
