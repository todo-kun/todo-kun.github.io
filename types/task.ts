import { z } from "zod";

const memberEmailSchema = z.string().trim().email("Enter a valid Google account email.");

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, "Task title is required.").max(120),
  dueDate: z.string().optional(),
  notes: z.string().max(1000).optional(),
  projectName: z.string().trim().max(80).optional(),
  categoryName: z.string().trim().max(80).optional(),
  memberEmails: z.array(memberEmailSchema).max(20).optional()
});

export const taskUpdateSchema = taskInputSchema.extend({
  completed: z.boolean().optional()
});

export const taxonomyKindSchema = z.enum(["project", "category"]);

export const taxonomyEntrySchema = z.object({
  kind: taxonomyKindSchema,
  name: z.string().trim().min(1, "Name is required.").max(80)
});

export type SyncState = "synced" | "not_connected" | "missing_config" | "failed";

export type TaskInput = z.infer<typeof taskInputSchema>;
export type TaxonomyKind = z.infer<typeof taxonomyKindSchema>;

export type TaskTaxonomy = {
  projects: string[];
  categories: string[];
};

export type TaskRecord = {
  id: string;
  title: string;
  dueDate: string | null;
  notes: string;
  projectName: string;
  categoryName: string;
  memberEmails: string[];
  createdAt: string;
  updatedAt: string;
  completed: boolean;
  calendarSync: SyncState;
  tasksSync: SyncState;
  calendarSyncMessage: string;
  tasksSyncMessage: string;
  lastSyncAttemptedAt: string | null;
  calendarEventId: string | null;
  googleTaskId: string | null;
};
