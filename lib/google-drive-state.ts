import { Readable } from "node:stream";
import { google } from "googleapis";
import { buildAuthorizedClient, getGoogleSession, hasGoogleOAuthConfig, type GoogleTokens } from "@/lib/google";
import type { RegisteredMember, TaskRecord, TaskTaxonomy } from "@/types/task";

const driveAppStateFileName = "todokun-state.json";

export type GoogleDriveAppState = {
  version: 1;
  updatedAt: string;
  taxonomy: TaskTaxonomy;
  members: RegisteredMember[];
  taskSnapshot: TaskRecord[];
};

const emptyState: GoogleDriveAppState = {
  version: 1,
  updatedAt: "",
  taxonomy: {
    projects: [],
    categories: []
  },
  members: [],
  taskSnapshot: []
};

function shouldUseGoogleDriveAppState() {
  return process.env.TASK_STORAGE_PROVIDER === "google";
}

function normalizeState(value: Partial<GoogleDriveAppState> | null | undefined): GoogleDriveAppState {
  return {
    version: 1,
    updatedAt: value?.updatedAt ?? "",
    taxonomy: {
      projects: value?.taxonomy?.projects ?? [],
      categories: value?.taxonomy?.categories ?? []
    },
    members: value?.members ?? [],
    taskSnapshot: value?.taskSnapshot ?? []
  };
}

async function getAuthorizedDrive(session?: GoogleTokens | null) {
  const sourceSession = session ?? (await getGoogleSession());

  if (!(await hasGoogleOAuthConfig())) {
    return null;
  }

  if (!sourceSession?.access_token && !sourceSession?.refresh_token) {
    return null;
  }

  const auth = await buildAuthorizedClient(sourceSession);
  return google.drive({ version: "v3", auth });
}

async function findAppStateFileId(drive: ReturnType<typeof google.drive>) {
  const response = await drive.files.list({
    spaces: "appDataFolder",
    q: `name = '${driveAppStateFileName}' and trashed = false`,
    pageSize: 1,
    fields: "files(id,name)"
  });

  return response.data.files?.[0]?.id ?? null;
}

async function readResponseStream(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

export async function readGoogleDriveAppState(session?: GoogleTokens | null) {
  if (!shouldUseGoogleDriveAppState()) {
    return null;
  }

  const drive = await getAuthorizedDrive(session);

  if (!drive) {
    return null;
  }

  try {
    const fileId = await findAppStateFileId(drive);

    if (!fileId) {
      return null;
    }

    const response = await drive.files.get(
      {
        fileId,
        alt: "media"
      },
      {
        responseType: "stream"
      }
    );

    const raw = await readResponseStream(response.data as unknown as NodeJS.ReadableStream);
    return normalizeState(JSON.parse(raw) as Partial<GoogleDriveAppState>);
  } catch {
    return null;
  }
}

export async function writeGoogleDriveAppState(
  input: Partial<GoogleDriveAppState>,
  session?: GoogleTokens | null
) {
  if (!shouldUseGoogleDriveAppState()) {
    return null;
  }

  const drive = await getAuthorizedDrive(session);

  if (!drive) {
    return null;
  }

  const current = (await readGoogleDriveAppState(session)) ?? emptyState;
  const next = normalizeState({
    ...current,
    ...input,
    taxonomy: {
      ...current.taxonomy,
      ...(input.taxonomy ?? {})
    },
    updatedAt: new Date().toISOString()
  });
  const fileId = await findAppStateFileId(drive);
  const media = {
    mimeType: "application/json",
    body: Readable.from([JSON.stringify(next, null, 2)])
  };

  if (fileId) {
    await drive.files.update({
      fileId,
      media
    });
  } else {
    await drive.files.create({
      requestBody: {
        name: driveAppStateFileName,
        parents: ["appDataFolder"]
      },
      media,
      fields: "id"
    });
  }

  return next;
}

export async function writeGoogleDriveTaskSnapshot(
  tasks: TaskRecord[],
  session?: GoogleTokens | null
) {
  return writeGoogleDriveAppState(
    {
      taskSnapshot: tasks
    },
    session
  );
}
