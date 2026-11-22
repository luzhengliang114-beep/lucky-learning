import type { EmployeeImportRow } from "./data";

export function employeeImportTemplate(brandName?: string, storeName?: string): string;
export function employeeRecordsFromMatrix(matrix: unknown[][]): EmployeeImportRow[];
export function normalizeEmployeeImportRecords(records: Array<Record<string, unknown>>, firstDataRow?: number): EmployeeImportRow[];
export function parseEmployeeCsv(text: string): EmployeeImportRow[];
