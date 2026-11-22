export interface PendingVideoProgress {
  id: string;
  employeeId: string;
  courseId: string;
  maxWatchedSeconds: number;
  videoDurationSeconds: number;
  ended: boolean;
  updatedAt: string;
}

export function normalizePendingVideoProgress(entry?: Partial<PendingVideoProgress>): PendingVideoProgress;
export function upsertPendingVideoProgress(entries: PendingVideoProgress[], entry: Partial<PendingVideoProgress>): PendingVideoProgress[];
export function removePendingVideoProgress(entries: PendingVideoProgress[], requestId: string): PendingVideoProgress[];
