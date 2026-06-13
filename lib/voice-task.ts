import { listRegisteredMembers } from "@/lib/members";
import { listTaxonomy } from "@/lib/taxonomy";
import { createTaskAndSync } from "@/lib/tasks";
import { getGoogleSession, type GoogleTokens } from "@/lib/google";
import { taskInputSchema, type RegisteredMember, type TaskInput, type TaskTaxonomy } from "@/types/task";

const openAiApiUrl = "https://api.openai.com/v1/responses";
const openAiModel = process.env.OPENAI_MODEL || "gpt-5-mini";

type VoiceTaskResult = {
  task: TaskInput;
  transcript: string;
  rawTask: {
    title?: string;
    dueDate?: string;
    notes?: string;
    projectName?: string;
    categoryName?: string;
    memberEmails?: string[];
  };
};

function normalizeOptionalText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMemberEmails(value: unknown, members: RegisteredMember[]) {
  const knownEmails = new Set(members.map((member) => member.email.toLowerCase()));

  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => knownEmails.has(item))
  )];
}

function pickKnownValue(value: string, candidates: string[]) {
  if (!value) {
    return "";
  }

  const exact = candidates.find((candidate) => candidate === value);

  if (exact) {
    return exact;
  }

  const normalized = value.toLowerCase();
  return candidates.find((candidate) => candidate.toLowerCase() === normalized) ?? value;
}

function normalizeDueDate(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const parsed = new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString();
}

function buildPrompt({
  transcript,
  taxonomy,
  members,
  now
}: {
  transcript: string;
  taxonomy: TaskTaxonomy;
  members: RegisteredMember[];
  now: Date;
}) {
  const todayJst = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  })
    .format(now)
    .replace(" ", "T");

  return [
    "You convert a Japanese voice memo into a task object for a browser task manager app.",
    "Return only valid JSON. Do not wrap it in markdown.",
    "Interpret relative dates using Asia/Tokyo time.",
    `Current Tokyo datetime: ${todayJst}`,
    "If a due date is unclear, return an empty string for dueDate.",
    "If time is omitted but the date is clear, keep the date and default the time to 09:00:00+09:00.",
    "Choose projectName only from the provided projects when possible.",
    "Choose categoryName only from the provided categories when possible.",
    "Choose memberEmails only from the provided member list when possible.",
    "If no matching project, category, or member is found, return an empty string or empty array.",
    "Output schema:",
    JSON.stringify({
      title: "string",
      dueDate: "ISO 8601 string or empty string",
      notes: "string",
      projectName: "string",
      categoryName: "string",
      memberEmails: ["string"]
    }),
    `Available projects: ${JSON.stringify(taxonomy.projects)}`,
    `Available categories: ${JSON.stringify(taxonomy.categories)}`,
    `Available members: ${JSON.stringify(members)}`,
    `Voice transcript: ${transcript}`
  ].join("\n");
}

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("AI response could not be read.");
  }

  const candidate = payload as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
  };

  if (typeof candidate.output_text === "string" && candidate.output_text.trim()) {
    return candidate.output_text.trim();
  }

  const contentTexts =
    candidate.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text)
      .filter((text): text is string => typeof text === "string" && text.trim().length > 0) ?? [];

  if (contentTexts.length > 0) {
    return contentTexts.join("\n").trim();
  }

  throw new Error("AI response was empty.");
}

async function requestVoiceTaskParsing(
  transcript: string,
  taxonomy: TaskTaxonomy,
  members: RegisteredMember[]
) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("Set OPENAI_API_KEY in Vercel before using voice input.");
  }

  const response = await fetch(openAiApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openAiModel,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildPrompt({
                transcript,
                taxonomy,
                members,
                now: new Date()
              })
            }
          ]
        }
      ]
    })
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? ((payload as { error?: { message?: string } }).error?.message ?? "AI task parsing failed.")
        : "AI task parsing failed.";
    throw new Error(message);
  }

  return extractResponseText(payload);
}

export async function buildTaskFromVoiceTranscript(transcript: string): Promise<VoiceTaskResult> {
  const normalizedTranscript = transcript.trim();

  if (!normalizedTranscript) {
    throw new Error("No voice transcript was received.");
  }

  const [taxonomy, members] = await Promise.all([listTaxonomy(), listRegisteredMembers()]);
  const rawText = await requestVoiceTaskParsing(normalizedTranscript, taxonomy, members);

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new Error("AI response could not be converted into a task.");
  }

  const candidate = parsedJson as {
    title?: unknown;
    dueDate?: unknown;
    notes?: unknown;
    projectName?: unknown;
    categoryName?: unknown;
    memberEmails?: unknown;
  };

  const normalizedTask = {
    title: normalizeOptionalText(candidate.title),
    dueDate: normalizeDueDate(candidate.dueDate),
    notes: normalizeOptionalText(candidate.notes),
    projectName: pickKnownValue(normalizeOptionalText(candidate.projectName), taxonomy.projects),
    categoryName: pickKnownValue(normalizeOptionalText(candidate.categoryName), taxonomy.categories),
    memberEmails: normalizeMemberEmails(candidate.memberEmails, members)
  };

  const parsedTask = taskInputSchema.safeParse(normalizedTask);

  if (!parsedTask.success) {
    throw new Error("AI could not assemble a valid task. Please try speaking a little more specifically.");
  }

  return {
    task: parsedTask.data,
    transcript: normalizedTranscript,
    rawTask: normalizedTask
  };
}

export async function createTaskFromVoiceTranscript(
  transcript: string,
  session: GoogleTokens | null = null
) {
  const sourceSession = session ?? (await getGoogleSession());
  const parsed = await buildTaskFromVoiceTranscript(transcript);
  const task = await createTaskAndSync(parsed.task, sourceSession);

  return {
    task,
    transcript: parsed.transcript,
    extracted: parsed.rawTask
  };
}
