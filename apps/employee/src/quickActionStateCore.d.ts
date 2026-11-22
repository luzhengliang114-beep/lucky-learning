import type { EmployeeAppData } from "./data";

export function applyCaseAcknowledgement(
  data: EmployeeAppData,
  caseId: string,
  acknowledgedAt?: string
): EmployeeAppData;

export function applyCourseReward(
  data: EmployeeAppData,
  courseId: string,
  result?: { goldenBeans?: number; award?: { delta?: number } }
): EmployeeAppData;

export function applyExamResult(
  data: EmployeeAppData,
  examId: string,
  result?: Record<string, unknown>
): EmployeeAppData;

export function applyPhraseResult(
  data: EmployeeAppData,
  phraseId: string,
  result?: Record<string, unknown>
): EmployeeAppData;
