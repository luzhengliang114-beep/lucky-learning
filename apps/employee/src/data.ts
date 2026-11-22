import { brandConfig } from "@open-training/shared";
import type { CompliancePolicy, Course, Employee, EmployeeRecording, Exam, GoldenBeanLedgerEntry, Phrase, Redemption, Reward, Store, Submission } from "@open-training/shared";
import { resolveDemoScenario } from "./demoAuthCore.js";
import { resolveLoginEntry } from "./loginEntry.js";
import { hasLogoutMarker, setLogoutMarker } from "./logoutStateCore.js";
import {
  removePendingVideoProgress,
  upsertPendingVideoProgress,
  type PendingVideoProgress
} from "./videoSyncQueueCore.js";

export type ContentType = "pop" | "phrase" | "case";

export interface EmployeeSession {
  sessionToken?: string;
  expiresAt?: string;
  employeeNo?: string;
  inviteCode?: string;
}

export interface CasePost extends Submission {
  publisherAvatar?: string;
  publisherName?: string;
  publisherStore?: string;
  images?: Array<{ fileId?: string; url?: string; imageUrl?: string; width?: number; height?: number }>;
  comments?: Array<{ id: string; employeeId: string; employeeName: string; content: string; createdAt: string }>;
}

export type ProductTaskState = "completed" | "learning-required" | "exam-required";

export interface ProductTaskStatus {
  productKey: string;
  periodKey: string;
  status: ProductTaskState;
  label: string;
  hasTaskData: boolean;
  targetQuantity: number;
  completedQuantity: number;
  attainmentRate: number;
}

export interface ProductTaskRankingEmployee extends Employee {
  store?: string;
  hasTaskData?: boolean;
  targetQuantity: number;
  completedQuantity: number;
  attainmentRate: number;
}

export interface ProductTaskRanking {
  productKey: string;
  productName: string;
  periodKey: string;
  rows: ProductTaskRankingEmployee[];
}

export type LearningTodoType = "video" | "material" | "audio" | "exam";

export interface LearningTodo {
  id: string;
  type: LearningTodoType;
  productKey: string;
  productName: string;
  title: string;
  progress: number;
  status: string;
  route: "learning" | "phrases" | "exam";
  locked?: boolean;
  sourceId?: string;
}

export interface LearningTodoGroup {
  productKey: string;
  productName: string;
  count: number;
  items: LearningTodo[];
}

export interface NotificationPreference {
  enabled: boolean;
  status: "enabled" | "disabled" | "not-enabled" | "not-authorized" | string;
  updatedAt: string;
}

export interface StoreProductRankingRow {
  id: string;
  storeId: string;
  storeName: string;
  targetQuantity: number;
  completedQuantity: number;
  attainmentRate: number;
  rank?: number;
}

export interface StoreProductRanking {
  productKey: string;
  productName: string;
  periodKey: string;
  rows: StoreProductRankingRow[];
}

export interface StoreTaskRewardOffer {
  id: string;
  eligible: boolean;
  productKey: string;
  title: string;
  description: string;
  itemValue: number;
  threshold: number;
  status: "active" | "inactive";
  periodKey: string;
  storeId: string;
  storeName: string;
  targetQuantity: number;
  completedQuantity: number;
  earnedCount: number;
  claimedCount: number;
  availableCount: number;
}

export interface EmployeeAppData {
  source: "cloudbase" | "fallback";
  bound: boolean;
  employee: Employee & { store?: string; region?: string };
  stores: Store[];
  courses: Array<Course & { hasVideo?: boolean; progress?: number; completed?: boolean; learningCompleted?: boolean; taskAutoCompleted?: boolean; taskStatus?: ProductTaskState; videoProgress?: VideoWatchProgress }>;
  phrases: Array<Phrase & { completedCount?: number; taskAutoCompleted?: boolean; taskStatus?: ProductTaskState }>;
  exams: Array<Exam & { completed?: boolean; taskAutoCompleted?: boolean; taskStatus?: ProductTaskState; attemptCount?: number; attemptsRemaining?: number; maxAttempts?: number; learningResetRequired?: boolean }>;
  productTaskStatuses: ProductTaskStatus[];
  productTaskRankings: ProductTaskRanking[];
  storeProductRankings: StoreProductRanking[];
  storeTaskRewards: StoreTaskRewardOffer[];
  rewards: Reward[];
  submissions: Submission[];
  cases: CasePost[];
  ranking: Array<Employee & { store?: string; productCompletionRates?: Record<string, number>; productGoldenBeans?: Record<string, number> }>;
  goldenBeanLedger: GoldenBeanLedgerEntry[];
  redemptions: Redemption[];
  recordings: EmployeeRecording[];
  learningTodos: LearningTodoGroup[];
  learningTodoCount: number;
  notificationPreference: NotificationPreference;
  policy: CompliancePolicy;
  isSupplier?: boolean;
  supplierLabel?: string;
}

export interface AuthResult {
  session?: EmployeeSession;
  demoBinding?: boolean;
  directEntry?: boolean;
  manualEntry?: boolean;
  identityProvider?: "wechat-oauth" | "manual-review";
  preselectedStoreId?: string;
  bound: boolean;
  employee?: EmployeeAppData["employee"] | null;
  stores: Store[];
  policy?: CompliancePolicy;
}

export interface ActionResult {
  message: string;
  data?: any;
}

export interface PptReadingProgress {
  slideCount: number;
  currentSlide: number;
  unlockedSlides: number;
  completed?: boolean;
  readingCompleted?: boolean;
  progress?: number;
}

export interface VideoWatchProgress {
  maxWatchedSeconds: number;
  videoDurationSeconds: number;
  videoWatchCompleted: boolean;
}

export interface ApiError extends Error {
  code?: string;
  candidates?: unknown[];
}

const employeeEndpoint = String(import.meta.env.VITE_EMPLOYEE_API_ENDPOINT || "").trim();
const sessionStorageKey = "employee-h5-session";
const demoStorageKey = "employee-h5-demo";
const preselectedStoreStorageKey = "employee-h5-preselected-store";
const pendingVideoProgressStorageKey = "employee-h5-pending-video-progress-v1";
const demoModeEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO === "1";
const employeeLoginMode = import.meta.env.VITE_EMPLOYEE_LOGIN_MODE === "manual-review" ? "manual-review" : "wechat-oauth";

function readLocalStorage(key: string) {
  try {
    return window.localStorage?.getItem(key) || null;
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string) {
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // Some embedded browsers disable persistent storage; the current session can still continue.
  }
}

function removeLocalStorage(key: string) {
  try {
    window.localStorage?.removeItem(key);
  } catch {
    // Ignore storage restrictions during logout and demo cleanup.
  }
}

function clientContext() {
  const userAgent = navigator.userAgent || "";
  const platform = /HarmonyOS|OpenHarmony|ArkWeb/i.test(userAgent)
    ? "harmony"
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? "ios"
      : /Android/i.test(userAgent)
        ? "android"
        : "other";
  const wechat = userAgent.match(/MicroMessenger\/([\d.]+)/i);
  return {
    platform,
    runtime: wechat ? "wechat" : "browser",
    runtimeVersion: wechat?.[1] || ""
  };
}

function readPendingVideoProgress(): PendingVideoProgress[] {
  try {
    const value = readLocalStorage(pendingVideoProgressStorageKey);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingVideoProgress(entries: PendingVideoProgress[]) {
  if (entries.length) writeLocalStorage(pendingVideoProgressStorageKey, JSON.stringify(entries));
  else removeLocalStorage(pendingVideoProgressStorageKey);
}

function pendingRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function queuePendingVideoWatchProgress(
  employeeId: string,
  courseId: string,
  progress: { maxWatchedSeconds: number; videoDurationSeconds: number; ended?: boolean }
) {
  const entry = {
    id: pendingRequestId(),
    employeeId,
    courseId,
    maxWatchedSeconds: progress.maxWatchedSeconds,
    videoDurationSeconds: progress.videoDurationSeconds,
    ended: progress.ended === true,
    updatedAt: new Date().toISOString()
  };
  const next = upsertPendingVideoProgress(readPendingVideoProgress(), entry);
  writePendingVideoProgress(next);
  return next.find((item) => item.employeeId === employeeId && item.courseId === courseId) || entry;
}

function clearPendingVideoWatchProgress(requestId: string) {
  writePendingVideoProgress(removePendingVideoProgress(readPendingVideoProgress(), requestId));
}

function normalizeId<T extends { _id?: string; id?: string }>(item: T): Omit<T, "_id"> & { id: string } {
  const { _id, ...rest } = item;
  return { ...rest, id: item.id || _id || crypto.randomUUID() };
}

function learningRecordCompleted(item: any) {
  return item?.learningCompleted === true
    || item?.completed === true
    || item?.videoWatchCompleted === true
    || item?.readingCompleted === true
    || Number(item?.progress || 0) >= 100;
}

function isWeChat() {
  return /MicroMessenger/i.test(navigator.userAgent);
}

export function isDemoMode() {
  return Boolean(currentDemoScenario());
}

function currentDemoScenario() {
  return resolveDemoScenario(window.location.search, demoModeEnabled, readLocalStorage(demoStorageKey) === "1");
}

export function enableDemoMode() {
  if (!demoModeEnabled) return;
  writeLocalStorage(demoStorageKey, "1");
  const url = new URL(window.location.href);
  url.searchParams.set("demo", "1");
  window.location.assign(url);
}

export function completeDemoBindingRehearsal() {
  if (!demoModeEnabled) return;
  writeLocalStorage(demoStorageKey, "1");
  const url = new URL(window.location.href);
  url.searchParams.set("demo", "1");
  window.history.replaceState({}, document.title, url);
}

export function recoverExpiredDemoRehearsal() {
  if (currentDemoScenario() !== "expired") return false;
  const url = new URL(window.location.href);
  url.searchParams.set("demo", "bind");
  window.history.replaceState({}, document.title, url);
  return true;
}

export function disableDemoMode() {
  removeLocalStorage(demoStorageKey);
}

export function getSavedSession(): EmployeeSession | null {
  try {
    const raw = readLocalStorage(sessionStorageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session: EmployeeSession) {
  writeLocalStorage(sessionStorageKey, JSON.stringify(session));
}

export function clearSession() {
  removeLocalStorage(sessionStorageKey);
}

async function post(
  action: string,
  session: EmployeeSession | null,
  payload: Record<string, unknown> = {},
  options: { keepalive?: boolean } = {}
) {
  if (!employeeEndpoint) throw new Error("员工服务尚未配置，请联系管理员");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch(employeeEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(session?.sessionToken ? { Authorization: `Bearer ${session.sessionToken}` } : {})
      },
      body: JSON.stringify({ action, ...(session?.sessionToken ? { sessionToken: session.sessionToken } : {}), ...payload, clientContext: clientContext() }),
      signal: controller.signal,
      keepalive: options.keepalive === true
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error("网络响应超时，请稍后重试");
    throw new Error("暂时无法连接学习服务，请检查网络后重试");
  } finally {
    window.clearTimeout(timeout);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    const error = new Error(result?.message || `请求失败：${response.status}`) as ApiError;
    error.code = result?.code;
    error.candidates = result?.candidates;
    throw error;
  }
  return result.data;
}

function redirectUri() {
  const url = new URL(import.meta.env.BASE_URL, window.location.origin);
  url.hash = "";
  return url.toString();
}

export async function bootstrapAuth(): Promise<{ status: "demo" | "bound" | "bind" | "logged-out" | "redirect"; data?: EmployeeAppData; auth?: AuthResult }> {
  if (hasLogoutMarker(window.location.search)) return { status: "logged-out" };
  const demoScenario = currentDemoScenario();
  if (new URLSearchParams(window.location.search).get("supplier") === "1" && (demoScenario === "ready" || demoModeEnabled)) {
    const { loadSupplierDemoData } = await import("./demoStore");
    return { status: "demo", data: await loadSupplierDemoData() };
  }
  if (demoScenario === "ready") {
    const { loadDemoData } = await import("./demoStore");
    return { status: "demo", data: await loadDemoData() };
  }
  if (demoScenario === "bind") {
    const { loadDemoBindingAuth } = await import("./demoStore");
    const demoAuth = await loadDemoBindingAuth();
    return { status: "bind", auth: { demoBinding: true, bound: false, employee: null, stores: demoAuth.stores } };
  }
  if (demoScenario === "expired") {
    const error = new Error("登录状态已过期，请重新确认员工身份") as ApiError;
    error.code = "WEB_SESSION_EXPIRED";
    throw error;
  }
  const loginEntry = resolveLoginEntry(window.location.search);
  const saved = getSavedSession();
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const callbackUri = redirectUri();

  if (employeeLoginMode === "wechat-oauth" && code && state) {
    const data = await post("oauth", null, { code, state, redirectUri: callbackUri });
    const session = { sessionToken: data.sessionToken, expiresAt: data.expiresAt } as EmployeeSession;
    saveSession(session);
    window.history.replaceState({}, document.title, "/employee/");
    const preselectedStoreId = readLocalStorage(preselectedStoreStorageKey) || "";
    removeLocalStorage(preselectedStoreStorageKey);
    const nextAuth = { ...data, session, stores: data.stores || [], preselectedStoreId } as AuthResult;
    if (data.bound) return { status: "bound", auth: nextAuth, data: await loadEmployeeData(session) };
    return { status: "bind", auth: nextAuth };
  }

  if (saved) {
    try {
      const auth = await post("session", saved) as AuthResult;
      const restoredAuth = { ...auth, session: saved, manualEntry: auth.identityProvider === "manual-review" };
      if (auth.bound) return { status: "bound", auth: restoredAuth, data: await loadEmployeeData(saved) };
      return { status: "bind", auth: restoredAuth };
    } catch (error) {
      clearSession();
    }
  }

  if (employeeLoginMode === "manual-review") {
    const data = await post("manualSession", null);
    const session = { sessionToken: data.sessionToken, expiresAt: data.expiresAt } as EmployeeSession;
    saveSession(session);
    return {
      status: "bind",
      auth: {
        ...data,
        session,
        manualEntry: true,
        bound: false,
        employee: null,
        stores: data.stores || [],
        preselectedStoreId: loginEntry.storeId || "",
        identityProvider: "manual-review"
      }
    };
  }

  if (loginEntry.mode === "direct") {
    const auth = await post("entryData", null, {});
    return {
      status: "bind",
      auth: {
        directEntry: true,
        bound: false,
        employee: null,
        stores: auth.stores || [],
        preselectedStoreId: loginEntry.storeId || ""
      }
    };
  }

  if (!isWeChat()) return { status: "redirect" };
  if (loginEntry.storeId) writeLocalStorage(preselectedStoreStorageKey, loginEntry.storeId);
  const authUrlData = await post("authUrl", null, { redirectUri: callbackUri });
  window.location.assign(authUrlData.authorizeUrl);
  return { status: "redirect" };
}

export async function bindEmployee(session: EmployeeSession, storeId: string, employeeName: string, noticeVersion: string): Promise<ActionResult> {
  const data = await post("bind", session, { storeId, employeeName, noticeVersion });
  return {
    message: "员工身份已确认，欢迎进入学习中心",
    data
  };
}

export async function directLogin(storeId: string, employeeName: string): Promise<ActionResult & { session: EmployeeSession; employee?: EmployeeAppData["employee"]; stores: Store[] }> {
  const data = await post("directLogin", null, { storeId, employeeName });
  const session = { sessionToken: data.sessionToken, expiresAt: data.expiresAt } as EmployeeSession;
  saveSession(session);
  return {
    message: "登录成功",
    data,
    session,
    employee: data.employee,
    stores: data.stores || []
  };
}

export async function logoutSession(session: EmployeeSession | null) {
  clearSession();
  disableDemoMode();
  const url = new URL(window.location.href);
  url.search = setLogoutMarker(url.search);
  window.history.replaceState({}, document.title, url);

  if (session?.sessionToken) {
    await post("logout", session).catch(() => null);
  }
}

export async function loadEmployeeData(session: EmployeeSession): Promise<EmployeeAppData> {
  const cloudData = await post("data", session);
  const employee = normalizeId(cloudData.employee) as EmployeeAppData["employee"];
  const isSupplier = employee.role === "supplier";
  const allowedProducts = new Set((employee.supplierProductKeys || []).map((item) => String(item).trim()).filter(Boolean));
  const productVisible = (item: { productName?: string }) => !isSupplier || allowedProducts.has(String(item.productName || "").trim());
  const visibleCourses = (cloudData.courses || []).filter(productVisible);
  const visiblePhrases = (cloudData.phrases || []).filter(productVisible);
  const visibleExams = (cloudData.exams || []).filter(productVisible);
  return {
    source: "cloudbase",
    bound: Boolean(cloudData.bound),
    employee,
    stores: (cloudData.stores || []).map(normalizeId) as Store[],
    courses: visibleCourses.map((course: any) => ({
      ...normalizeId(course),
      learningCompleted: learningRecordCompleted(course),
      completed: Boolean(course.completed),
      progress: Math.max(0, Math.min(100, Number(course.progress || 0)))
    })),
    phrases: visiblePhrases.map(normalizeId),
    exams: visibleExams.map((exam: any) => normalizeId({ ...exam, questions: exam.questions || [] })),
    productTaskStatuses: cloudData.productTaskStatuses || [],
    productTaskRankings: cloudData.productTaskRankings || [],
    storeProductRankings: (cloudData.storeProductRankings || []).filter((item: any) => (
      !isSupplier || allowedProducts.has(String(item.productKey || "").trim())
    )),
    storeTaskRewards: (cloudData.storeTaskRewards || []).map(normalizeId),
    rewards: (cloudData.rewards || []).map(normalizeId),
    submissions: (cloudData.submissions || []).map(normalizeId),
    cases: (cloudData.cases || []).map(normalizeId),
    ranking: (cloudData.ranking || []).filter((item: any) => item.role !== "supplier").map(normalizeId),
    goldenBeanLedger: (cloudData.goldenBeanLedger || []).map(normalizeId),
    redemptions: (cloudData.redemptions || []).map(normalizeId),
    recordings: (cloudData.recordings || []).map(normalizeId) as EmployeeRecording[],
    learningTodos: (cloudData.learningTodos || []).map((group: any) => ({
      productKey: String(group.productKey || ""),
      productName: String(group.productName || group.productKey || ""),
      count: Number(group.count || 0),
      items: (group.items || []).map((item: any) => ({
        ...item,
        progress: Math.max(0, Math.min(100, Number(item.progress || 0)))
      }))
    })) as LearningTodoGroup[],
    learningTodoCount: Number(cloudData.learningTodoCount || 0),
    notificationPreference: cloudData.notificationPreference || { enabled: false, status: "not-enabled", updatedAt: "" },
    policy: cloudData.policy || demoPolicy(),
    isSupplier,
    supplierLabel: isSupplier ? `供应商｜${employee.supplierName || "未填写厂家"}` : undefined
  };
}

export async function updateNotificationPreference(session: EmployeeSession, enabled: boolean): Promise<NotificationPreference & { message?: string }> {
  return post("notificationPreference", session, { enabled });
}

export async function loadCourseDetail(session: EmployeeSession, courseId: string) {
  return post("courseDetail", session, { courseId });
}

export async function loadPptReadingProgress(session: EmployeeSession, courseId: string): Promise<PptReadingProgress> {
  const data = await post("pptProgress", session, { courseId });
  return data.progress;
}

export async function startPptReadingSlide(session: EmployeeSession, courseId: string, slideIndex: number): Promise<PptReadingProgress> {
  const data = await post("startPptSlide", session, { courseId, slideIndex });
  return data.progress;
}

export async function completePptReadingSlide(session: EmployeeSession, courseId: string, slideIndex: number): Promise<PptReadingProgress> {
  const data = await post("completePptSlide", session, { courseId, slideIndex });
  return data.progress;
}

export async function syncVideoWatchProgress(
  session: EmployeeSession,
  courseId: string,
  progress: { maxWatchedSeconds: number; videoDurationSeconds: number; ended?: boolean },
  options: { employeeId?: string; keepalive?: boolean } = {}
): Promise<VideoWatchProgress> {
  const pending = options.employeeId
    ? queuePendingVideoWatchProgress(options.employeeId, courseId, progress)
    : null;
  const data = await post("syncVideoProgress", session, { courseId, ...progress }, { keepalive: options.keepalive });
  if (pending) clearPendingVideoWatchProgress(pending.id);
  return data.progress;
}

export async function flushPendingVideoWatchProgress(session: EmployeeSession, employeeId: string) {
  const entries = readPendingVideoProgress().filter((entry) => entry.employeeId === employeeId);
  for (const entry of entries) {
    try {
      await post("syncVideoProgress", session, {
        courseId: entry.courseId,
        maxWatchedSeconds: entry.maxWatchedSeconds,
        videoDurationSeconds: entry.videoDurationSeconds,
        ended: entry.ended
      });
      clearPendingVideoWatchProgress(entry.id);
    } catch {
      // Keep the remaining progress for the next app launch or network recovery.
    }
  }
}

export async function completeCourse(session: EmployeeSession, courseId: string, options: { pptCompleted?: boolean } = {}): Promise<ActionResult> {
  const data = await post("completeCourse", session, { courseId, pptCompleted: Boolean(options.pptCompleted) });
  if (options.pptCompleted) return { message: "PPT 学习已完成并记录", data };
  return { message: data.award?.delta ? `岗位视频完成，获得 ${data.award.delta} 金豆` : "岗位视频已完成，金豆已领取过", data };
}

export async function submitExam(session: EmployeeSession, examId: string, answers: Array<{ questionId: string; value: number | number[] }> | number[]): Promise<ActionResult> {
  const normalizedAnswers = answers.map((answer, index) => typeof answer === "number"
    ? { questionId: String(index), value: answer }
    : answer);
  const data = await post("submitExam", session, { examId, answers: normalizedAnswers });
  return { message: data.passed ? `测评通过，得分 ${data.score}，本次获得 ${data.award?.delta || 0} 金豆` : `测评未通过，得分 ${data.score}`, data };
}

export async function submitContent(session: EmployeeSession, payload: { type: ContentType; title: string; content?: string; fileId?: string; phraseId?: string; recordingFileId?: string; images?: unknown[]; videoFileId?: string; casePrivacyConfirmed?: boolean; casePrivacyVersion?: string }): Promise<ActionResult> {
  const data = await post("submitContent", session, payload);
  return { message: data.message || "已提交管理员审核，通过后会展示在案例广场", data };
}

export async function acceptRecordingNotice(session: EmployeeSession, noticeVersion: string): Promise<ActionResult> {
  const data = await post("acceptRecordingNotice", session, { noticeVersion });
  return { message: "录音使用说明已确认", data };
}

export async function deleteRecording(session: EmployeeSession, fileId: string): Promise<ActionResult> {
  const data = await post("deleteRecording", session, { fileId });
  return { message: "原始录音已删除，练习结果和金豆记录继续保留", data };
}

export function demoPolicy(): CompliancePolicy {
  return {
    employeeNoticeVersion: "employee-privacy-2026-07-30",
    recordingNoticeVersion: "recording-use-2026-07-30",
    casePrivacyVersion: "case-deidentification-2026-07-30",
    privacyContact: brandConfig.privacyContact
  };
}

export async function uploadMedia(session: EmployeeSession, file: File | Blob, folder: string) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
  return post("uploadMedia", session, { dataUrl, folder, fileName: file instanceof File ? file.name : "recording.webm" });
}

export async function submitStoreReceipt(session: EmployeeSession, file: File): Promise<ActionResult> {
  const upload = await uploadMedia(session, file, "employee-web/store-receipts");
  const data = await post("submitStoreReceipt", session, { fileId: upload.fileID || upload.data?.fileID || upload.data?.fileId });
  if (data.receipt?.status === "review") {
    const error = new Error(data.message || "小票识别不通过，请重新上传清晰图片") as ApiError;
    error.code = "RECEIPT_REVIEW_REQUIRED";
    throw error;
  }
  return { message: data.message || "小票已提交", data };
}

export async function recognizePhrase(session: EmployeeSession, phraseId: string, fileId: string): Promise<ActionResult> {
  const data = await post("recognizePhrase", session, { phraseId, fileId });
  if (!data.passed) {
    throw new Error(`识别相似度 ${Number(data.score || 0)}%，请完整说出话术后重试`);
  }
  const awarded = Number(data.award?.delta || 0);
  return {
    message: awarded > 0
      ? `识别通过，相似度 ${Number(data.score || 0)}%，获得 ${awarded} 金豆`
      : `识别通过，相似度 ${Number(data.score || 0)}%，本次不再重复发放金豆`,
    data
  };
}

export async function addComment(session: EmployeeSession, caseId: string, content: string): Promise<ActionResult> {
  const data = await post("addComment", session, { caseId, content });
  return { message: "评论已发布", data };
}

export async function acknowledgeCase(session: EmployeeSession, caseId: string): Promise<ActionResult> {
  const data = await post("acknowledgeCase", session, { caseId });
  return { message: data.message || "已确认收到", data };
}

export async function redeemReward(session: EmployeeSession, rewardId: string): Promise<ActionResult> {
  const data = await post("redeemReward", session, { rewardId });
  return { message: `兑换申请已提交，剩余 ${data.goldenBeans} 金豆`, data };
}

export async function redeemStoreTaskReward(session: EmployeeSession, storeTaskRewardId: string): Promise<ActionResult> {
  const data = await post("redeemStoreTaskReward", session, { storeTaskRewardId });
  return {
    message: `已提交领取申请，本店当前剩余 ${Number(data.availableCount || 0)} 次领取额度`,
    data
  };
}
