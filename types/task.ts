import { z } from "zod";

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, "Task title is required.").max(120),
  dueDate: z.string().optional(),
  notes: z.string().max(1000).optional()
});

export const taskUpdateSchema = taskInputSchema.extend({
  completed: z.boolean().optional()
});

export type SyncState = "synced" | "not_connected" | "missing_config" | "failed";

export type TaskInput = z.infer<typeof taskInputSchema>;

export type TaskRecord = {
  id: string;
  title: string;
  dueDate: string | null;
  notes: string;
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
