import type { EmployeeProductTaskImportRow } from "./data";

export function productTaskImportTemplate(): string;
export function productTaskRecordsFromMatrix(matrix: unknown[][]): EmployeeProductTaskImportRow[];
export function parseProductTaskCsv(text: string): EmployeeProductTaskImportRow[];
