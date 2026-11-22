import type { ActionResult, EmployeeAppData, EmployeeSession } from "./data";
import type { DemoAction } from "./demoStore";

export type AppRoute = "home" | "learning" | "exam" | "phrases" | "cases" | "rewards" | "ranking" | "profile" | "search" | "boundary";

export type Notice = {
  type: "success" | "error" | "info";
  text: string;
};

export type RunActionOptions = {
  demoAction?: DemoAction;
  refreshMode?: "blocking" | "background" | "none";
  applyResult?: (data: EmployeeAppData, result: ActionResult) => EmployeeAppData;
};

export type RefreshOptions = {
  fresh?: boolean;
};

export type RunAction = (
  key: string,
  action: () => Promise<ActionResult>,
  options?: RunActionOptions
) => Promise<ActionResult | undefined>;

export interface PageProps {
  data: EmployeeAppData;
  session: EmployeeSession | null;
  busy: string;
  navigate: (route: AppRoute) => void;
  receiptCaptureFiles?: File[] | null;
  onReceiptCaptureHandled?: () => void;
  notify: (notice: Notice) => void;
  clearNotice: () => void;
  refresh: (options?: RefreshOptions) => Promise<EmployeeAppData | undefined>;
  recordLearningProgress: (courseId: string, resourceType: "video" | "ppt") => Promise<EmployeeAppData | undefined>;
  runAction: RunAction;
}
