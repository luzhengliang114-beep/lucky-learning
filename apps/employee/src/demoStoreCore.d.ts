import type { EmployeeAppData } from "./data";

export type DemoActionName = "completeCourse" | "recordCourseLearningProgress" | "submitExam" | "submitPhrase" | "publishCase" | "addComment" | "acknowledgeCase" | "redeemReward" | "redeemStoreTaskReward" | "updateProfile" | "deleteRecording";

export interface DemoActionResult {
  nextData: EmployeeAppData;
  message: string;
  data?: Record<string, unknown>;
}

export function restoreDemoState(raw: string | null | unknown, fallbackData: EmployeeAppData): EmployeeAppData;
export function serializeDemoState(data: EmployeeAppData): string;
export function reduceDemoAction(current: EmployeeAppData, action: DemoActionName, payload?: Record<string, any>, options?: { id?: string; now?: string }): DemoActionResult;
export const DEMO_SCHEMA_VERSION: number;
