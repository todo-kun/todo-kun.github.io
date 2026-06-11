import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.join(process.cwd(), "data");

export async function readJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  const filePath = path.join(dataDir, fileName);

  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

export async function writeJsonFile<T>(fileName: string, value: T) {
  const filePath = path.join(dataDir, fileName);
  await mkdir(dataDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}
