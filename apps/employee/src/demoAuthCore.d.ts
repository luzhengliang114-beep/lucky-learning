import type { Employee } from "@open-training/shared";
import type { EmployeeAppData } from "./data";

export type DemoScenario = "ready" | "bind" | "expired" | "pending" | "rejected" | null;

export interface DemoDirectoryEmployee extends Employee {
  store?: string;
}

export interface DemoBindingResult {
  nextData: EmployeeAppData;
  employee: EmployeeAppData["employee"];
}

export function resolveDemoScenario(search: string, enabled: boolean, persisted?: boolean): DemoScenario;
export function bindDemoEmployeeData(
  current: EmployeeAppData,
  directory: DemoDirectoryEmployee[],
  storeId: string,
  employeeName: string
): DemoBindingResult;
