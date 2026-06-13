import { cookies } from "next/headers";
import { readJsonFile, writeJsonFile } from "@/lib/file-store";
import { readGoogleDriveAppState, writeGoogleDriveAppState } from "@/lib/google-drive-state";
import type { RegisteredMember } from "@/types/task";

const membersFileName = "members.json";
const membersCookieName = "tm1";

function shouldUseCookieMembers() {
  return process.env.NODE_ENV === "production";
}

function normalizeMember(member: RegisteredMember): RegisteredMember {
  return {
    name: member.name.trim(),
    email: member.email.trim().toLowerCase(),
    projectNames: [...new Set((member.projectNames ?? []).map((project) => project.trim()).filter(Boolean))].sort(
      (left, right) => left.localeCompare(right, "ja")
    )
  };
}

function normalizeMembers(members: RegisteredMember[] | null | undefined) {
  return [...new Map(
    (members ?? [])
      .map(normalizeMember)
      .filter((member) => member.name && member.email)
      .map((member) => [member.email, member])
  ).values()].sort((left, right) => left.name.localeCompare(right.name, "ja"));
}

async function readCookieMembers() {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get(membersCookieName)?.value;

    if (!raw) {
      return null;
    }

    return JSON.parse(decodeURIComponent(raw)) as RegisteredMember[];
  } catch {
    return null;
  }
}

async function writeCookieMembers(members: RegisteredMember[]) {
  const cookieStore = await cookies();
  cookieStore.set(membersCookieName, encodeURIComponent(JSON.stringify(members)), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
}

export async function listRegisteredMembers() {
  const sharedState = await readGoogleDriveAppState();
  const members =
    sharedState?.members ??
    (shouldUseCookieMembers()
      ? await readCookieMembers()
      : await readJsonFile<RegisteredMember[] | null>(membersFileName, null));

  return normalizeMembers(members);
}

export async function saveRegisteredMembers(members: RegisteredMember[]) {
  const normalized = normalizeMembers(members);

  await writeGoogleDriveAppState({
    members: normalized
  }).catch(() => null);

  if (shouldUseCookieMembers()) {
    await writeCookieMembers(normalized);
    return normalized;
  }

  await writeJsonFile(membersFileName, normalized);
  return normalized;
}

export async function upsertRegisteredMember(member: RegisteredMember) {
  const current = await listRegisteredMembers();
  const normalized = normalizeMember(member);
  const existing = current.find((item) => item.email === normalized.email);

  if (!existing) {
    return saveRegisteredMembers([...current, normalized]);
  }

  return saveRegisteredMembers(
    current.map((item) =>
      item.email === normalized.email
        ? {
            ...item,
            name: normalized.name || item.name,
            projectNames: [...new Set([...item.projectNames, ...normalized.projectNames])].sort((left, right) =>
              left.localeCompare(right, "ja")
            )
          }
        : item
    )
  );
}

export async function updateRegisteredMember(email: string, member: Omit<RegisteredMember, "email">) {
  const current = await listRegisteredMembers();
  const normalizedEmail = email.trim().toLowerCase();
  const existing = current.find((item) => item.email === normalizedEmail);

  if (!existing) {
    throw new Error("Member could not be found.");
  }

  return saveRegisteredMembers(
    current.map((item) =>
      item.email === normalizedEmail
        ? normalizeMember({
            name: member.name,
            email: normalizedEmail,
            projectNames: member.projectNames ?? []
          })
        : item
    )
  );
}

export async function deleteRegisteredMember(email: string) {
  const current = await listRegisteredMembers();
  const normalizedEmail = email.trim().toLowerCase();
  const nextMembers = current.filter((item) => item.email !== normalizedEmail);

  if (nextMembers.length === current.length) {
    throw new Error("Member could not be found.");
  }

  return saveRegisteredMembers(nextMembers);
}
