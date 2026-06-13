import { readJsonFile, writeJsonFile } from "@/lib/file-store";
import type { TaskTaxonomy, TaxonomyKind } from "@/types/task";

const taxonomyFileName = "taxonomy.json";

const defaultCategories = ["メール送信", "アポ調整", "資料作成"];

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

export async function listTaxonomy() {
  const taxonomy = await readJsonFile<Partial<TaskTaxonomy> | null>(taxonomyFileName, null);
  return normalizeTaxonomy(taxonomy);
}

export async function saveTaxonomy(taxonomy: Partial<TaskTaxonomy> | null | undefined) {
  const normalized = normalizeTaxonomy(taxonomy);
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
