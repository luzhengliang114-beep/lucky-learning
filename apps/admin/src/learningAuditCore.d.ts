export type AuditPlatform = "ios" | "android" | "harmony" | "other" | "unknown" | string;
export interface CourseAuditRow { id: string; productName: string; title: string; status: "completed" | "in-progress" | "not-started"; progress: number; lastActivityAt: string; platform: AuditPlatform; }
export interface ExamAuditRow { id: string; productName: string; title: string; status: "passed" | "failed" | "not-started"; score: number; attemptCount: number; lastActivityAt: string; platform: AuditPlatform; }
export interface PhraseAuditRow { id: string; productName: string; title: string; status: "completed" | "in-progress" | "not-started"; completedCount: number; requiredCount: number; lastActivityAt: string; platform: AuditPlatform; }
export interface EmployeeLearningAudit { hasActivity: boolean; courseRows: CourseAuditRow[]; examRows: ExamAuditRow[]; phraseRows: PhraseAuditRow[]; }
export function buildEmployeeLearningAudit(input: Record<string, unknown>): EmployeeLearningAudit;
