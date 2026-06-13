import { cookies } from "next/headers";
import { readGoogleDriveAppState, writeGoogleDriveAppState } from "@/lib/google-drive-state";
import { readJsonFile, writeJsonFile } from "@/lib/file-store";
import type { TaskTaxonomy, TaxonomyKind } from "@/types/task";

const taxonomyFileName = "taxonomy.json";
const taxonomyCookieName = "tx1";

const defaultCategories = ["メール送信", "アポ調整", "資料作成"];

function shouldUseCookieTaxonomy() {
  return process.env.NODE_ENV === "production";
}

function normalizeName(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.map(normalizeName).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "ja")
  );
}

function normalizeTaxonomy(taxonomy: Partial<TaskTaxonomy> | null | undefined): TaskTaxonomy {
  return {
    projects: uniqueSorted(taxonomy?.projects ?? []),
    categories: uniqueSorted([...(taxonomy?.categories ?? []), ...defaultCategories])
  };
}

async function readCookieTaxonomy() {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get(taxonomyCookieName)?.value;

    if (!raw) {
      return null;
    }

    return JSON.parse(decodeURIComponent(raw)) as Partial<TaskTaxonomy>;
  } catch {
    return null;
  }
}

async function writeCookieTaxonomy(taxonomy: TaskTaxonomy) {
  const cookieStore = await cookies();

  cookieStore.set(
    taxonomyCookieName,
    encodeURIComponent(JSON.stringify(taxonomy)),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30
    }
  );
}

export async function listTaxonomy() {
  const sharedState = await readGoogleDriveAppState();
  const taxonomy =
    sharedState?.taxonomy ??
    (shouldUseCookieTaxonomy()
      ? await readCookieTaxonomy()
      : await readJsonFile<Partial<TaskTaxonomy> | null>(taxonomyFileName, null));
  return normalizeTaxonomy(taxonomy);
}

export async function saveTaxonomy(taxonomy: Partial<TaskTaxonomy> | null | undefined) {
  const normalized = normalizeTaxonomy(taxonomy);

  await writeGoogleDriveAppState({
    taxonomy: normalized
  }).catch(() => null);

  if (shouldUseCookieTaxonomy()) {
    await writeCookieTaxonomy(normalized);
    return normalized;
  }

  await writeJsonFile(taxonomyFileName, normalized);
  return normalized;
}

export async function addTaxonomyEntry(kind: TaxonomyKind, name: string) {
  const normalizedName = normalizeName(name);

  if (!normalizedName) {
    return listTaxonomy();
  }

  const current = await listTaxonomy();

  if (kind === "project") {
    return saveTaxonomy({
      ...current,
      projects: [...current.projects, normalizedName]
    });
  }

  return saveTaxonomy({
    ...current,
    categories: [...current.categories, normalizedName]
  });
}

export async function ensureTaskTaxonomy(projectName?: string | null, categoryName?: string | null) {
  const current = await listTaxonomy();
  return saveTaxonomy({
    projects: projectName ? [...current.projects, projectName] : current.projects,
    categories: categoryName ? [...current.categories, categoryName] : current.categories
  });
}
