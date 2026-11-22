export type LearningProgressItem = {
  id?: string; _id?: string; track?: string; productName?: string; productKey?: string; productId?: string;
  maxRewardedAttempts?: number; completedCount?: number; completed?: boolean; learningCompleted?: boolean;
  videoWatchCompleted?: boolean; readingCompleted?: boolean; progress?: number; status?: string; title?: string;
  resourceType?: string; slideCount?: number; videoDurationSeconds?: number;
  videoProgress?: { maxWatchedSeconds?: number; videoDurationSeconds?: number; videoWatchCompleted?: boolean };
  pptProgress?: { unlockedSlides?: number; slideCount?: number; readingCompleted?: boolean };
  learningResetRequired?: boolean; taskAutoCompleted?: boolean;
};
export type LearningTodoItem = {
  id: string; type: "video" | "material" | "audio" | "exam"; productKey: string; productName: string;
  title: string; progress: number; status: string; route: "learning" | "phrases" | "exam"; locked?: boolean;
};
export type LearningTodoGroup = { productKey: string; productName: string; count: number; items: LearningTodoItem[] };
export function courseProgressPercent(course?: LearningProgressItem, completedCourseIds?: ReadonlySet<string>): number;
export function learningProgressSummary(data?: {
  courses?: LearningProgressItem[]; phrases?: LearningProgressItem[]; exams?: LearningProgressItem[];
  submissions?: Array<{ type?: string; phraseId?: string; status?: string }>;
  productTaskStatuses?: Array<{ productKey?: string; status?: string }>;
  completedCourseIds?: ReadonlySet<string>;
}, options?: { includeSpeaking?: boolean }): { completed: number; total: number; percent: number };
export function learningTodoGroups(data?: {
  isSupplier?: boolean; courses?: LearningProgressItem[]; phrases?: LearningProgressItem[]; exams?: LearningProgressItem[];
  submissions?: Array<{ type?: string; phraseId?: string; status?: string }>;
  productTaskStatuses?: Array<{ productKey?: string; status?: string }>;
  completedCourseIds?: ReadonlySet<string>;
}, options?: { includeSpeaking?: boolean }): LearningTodoGroup[];
