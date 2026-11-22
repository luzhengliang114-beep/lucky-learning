import {
  brands as fallbackBrands,
  courses as fallbackCourses,
  dashboardStats as fallbackDashboardStats,
  employees as fallbackEmployees,
  exams as fallbackExams,
  goldenBeanLedger as fallbackGoldenBeanLedger,
  phrases as fallbackPhrases,
  redemptions as fallbackRedemptions,
  demoRewards as fallbackRewards,
  stores as fallbackStores,
  submissions as fallbackSubmissions
} from "@open-training/shared";
import type {
  Brand,
  Course,
  Employee,
  EmployeeApplication,
  Exam,
  GoldenBeanLedgerEntry,
  Phrase,
  ProductRewardRule,
  Redemption,
  Reward,
  Store,
  Submission,
  CaseComment,
  Question
} from "@open-training/shared";
import { loadAdminDemoData, runAdminDemoAction, uploadAdminDemoAsset } from "./adminDemoStore";

export type DataSource = "cloudbase" | "fallback" | "demo";
export type ReviewDecision = "approved" | "rejected";
export type ReviewSubmissionType = "pop" | "phrase" | "case";
export type CourseTrack = "product" | "chronic";
export type ChronicCategory = "diabetes" | "hypertension" | "hyperuricemia" | "hyperlipidemia";

export interface EmployeeProductTask { id: string; employeeId: string; employeeName: string; storeId?: string; storeName?: string; productKey: string; periodKey: string; targetQuantity: number; completedQuantity: number; attainmentRate?: number; source?: string; updatedAt?: string; }
export interface StoreProductSale { id: string; storeId: string; storeName: string; productKey: string; periodKey: string; targetQuantity: number; completedQuantity: number; attainmentRate?: number; source?: string; createdAt?: string; updatedAt?: string; }
export interface StoreTaskReward { id: string; productKey: string; title: string; description: string; itemValue: number; threshold: number; status: "active" | "inactive"; createdAt?: string; updatedAt?: string; }
export interface StoreReceipt { id: string; employeeId?: string; storeId?: string; storeName?: string; productKey?: string; receiptNo?: string; saleDate?: string; quantity: number; confidence?: number; imageFileId?: string; status: "approved" | "review" | "rejected"; reviewReason?: string; createdAt?: string; updatedAt?: string; }
export interface CourseProgressRecord {
  id: string;
  employeeId: string;
  courseId: string;
  completed: boolean;
  progress?: number;
  videoWatchCompleted?: boolean;
  readingCompleted?: boolean;
  unlockedSlides?: number;
  videoDurationSeconds?: number;
  maxWatchedSeconds?: number;
  updatedAt?: string;
  clientContext?: { platform?: string; runtime?: string; runtimeVersion?: string };
}
export interface ExamAttemptRecord { id: string; employeeId: string; examId: string; score: number; passed: boolean; createdAt?: string; clientContext?: { platform?: string; runtime?: string; runtimeVersion?: string }; }
export interface PhrasePracticeAttemptRecord { id: string; employeeId: string; phraseId: string; passed: boolean; counted?: boolean; createdAt?: string; clientContext?: { platform?: string; runtime?: string; runtimeVersion?: string }; }

export interface SupplierEmployeeMetric extends Employee {
  store?: string;
  completionRate: number;
  contentCompletionRate: number;
  examPassRate: number;
}

export interface SupplierProductView {
  productKey: string;
  productName: string;
  averageCompletionRate: number;
  employees: SupplierEmployeeMetric[];
}

export interface SupplierView {
  supplierId: string;
  supplierName: string;
  supplierLabel: string;
  wechatBound?: boolean;
  wechatNickname?: string;
  productKeys: string[];
  products: SupplierProductView[];
}

export interface AdminData {
  source: DataSource;
  brands: Brand[];
  employees: Employee[];
  employeeApplications: EmployeeApplication[];
  stores: Store[];
  courses: Course[];
  phrases: Phrase[];
  productRewardRules: ProductRewardRule[];
  exams: Exam[];
  questions: Array<Question & { examId: string; sortOrder?: number }>;
  submissions: Submission[];
  caseComments: CaseComment[];
  goldenBeanLedger: GoldenBeanLedgerEntry[];
  rewards: Reward[];
  redemptions: Redemption[];
  employeeProductTasks: EmployeeProductTask[];
  storeProductSales: StoreProductSale[];
  storeTaskRewards: StoreTaskReward[];
  storeReceipts: StoreReceipt[];
  courseProgress: CourseProgressRecord[];
  examAttempts: ExamAttemptRecord[];
  phrasePracticeAttempts: PhrasePracticeAttemptRecord[];
  supplierViews: SupplierView[];
  taskRewards: {
    pop: number;
    phrase: number;
    case: number;
  };
  dashboardStats: {
    totalEmployees: number;
    averageCompletion: number;
    examPassRate: number;
    pendingReviews: number;
    pendingEmployeeApplications: number;
    issuedGoldenBeans: number;
  };
}

export type EmployeeWechatBindingSummary = {
  wechatBound?: boolean;
  wechatBindingCount?: number;
  wechatNickname?: string;
};

const adminDataEndpoint = String(import.meta.env.VITE_ADMIN_API_ENDPOINT || "").trim();
export const isAdminDemoMode = typeof window !== "undefined" && (
  new URLSearchParams(window.location.search).get("demo") === "1"
  || (!adminDataEndpoint && ["localhost", "127.0.0.1"].includes(window.location.hostname))
);
const directUploadLimitBytes = 3 * 1024 * 1024;
const chunkUploadSizeBytes = 2.5 * 1024 * 1024;

function endpoint() {
  if (!adminDataEndpoint) throw new Error("管理服务尚未配置，请设置 VITE_ADMIN_API_ENDPOINT");
  return adminDataEndpoint;
}

function adminHeaders(secret: string, includeJson = true) {
  const token = String(secret || "").trim();
  if (!token) throw new Error("请输入管理访问口令");
  return {
    ...(includeJson ? { "content-type": "application/json" } : {}),
    Accept: "application/json",
    Authorization: `Bearer ${token}`
  };
}

type UploadedAsset = {
  fileID: string;
  url: string;
  cloudPath: string;
  size?: number;
  contentType?: string;
};

type DirectUploadDescriptor = UploadedAsset & {
  uploadUrl: string;
  authorization: string;
  token: string;
  cosFileId: string;
};

function normalizeId<T extends { _id?: string; id?: string }>(item: T): Omit<T, "_id"> & { id: string } {
  const { _id, ...rest } = item;
  return {
    ...rest,
    id: item.id || _id || crypto.randomUUID()
  };
}

function normalizeSubmission(item: any): Submission {
  return normalizeId({
    ...item,
    status: item.status || "pending",
    goldenBeans: Number(item.goldenBeans || 0)
  }) as Submission;
}

function buildDashboardStats(data: Omit<AdminData, "source" | "dashboardStats">): AdminData["dashboardStats"] {
  const staff = data.employees.filter((employee) => employee.role !== "supplier");
  return {
    totalEmployees: staff.length,
    averageCompletion:
      staff.length === 0
        ? 0
        : Math.round(staff.reduce((sum, employee) => sum + Number(employee.courseCompletionRate || 0), 0) / staff.length),
    examPassRate:
      staff.length === 0
        ? 0
        : Math.round(staff.reduce((sum, employee) => sum + Number(employee.examPassRate || 0), 0) / staff.length),
    pendingReviews: data.submissions.filter((item) => item.status === "pending").length,
    pendingEmployeeApplications: data.employeeApplications.filter((item) => item.status === "pending").length,
    issuedGoldenBeans: data.goldenBeanLedger
      .filter((item) => Number(item.delta) > 0)
      .reduce((sum, item) => sum + Number(item.delta || 0), 0)
  };
}

export function getFallbackAdminData(): AdminData {
  const demoSupplier: Employee = {
    id: "demo-supplier",
    name: "示例供应商",
    employeeNo: "SUPPLIER-001",
    position: "供应商",
    role: "supplier",
    storeId: fallbackStores[0]?.id || "",
    regionId: fallbackStores[0]?.regionId || "default",
    goldenBeans: 0,
    courseCompletionRate: 0,
    examPassRate: 0,
    status: "active",
    supplierName: "示例产品A厂家",
    supplierProductKeys: ["示例产品A"]
  };
  return {
    source: "fallback",
    brands: fallbackBrands,
    employees: [...fallbackEmployees, demoSupplier],
    employeeApplications: fallbackStores[0] ? [
      {
        id: "demo-application-pending",
        employeeName: "陈小健",
        storeId: fallbackStores[0].id,
        status: "pending",
        submittedAt: "2026-07-30T09:20:00.000Z",
        reviewRound: 1,
        wechatNickname: "小健"
      },
      {
        id: "demo-application-rejected",
        employeeName: "李新",
        storeId: fallbackStores[1]?.id || fallbackStores[0].id,
        status: "rejected",
        submittedAt: "2026-07-29T08:10:00.000Z",
        reviewedAt: "2026-07-29T10:00:00.000Z",
        reviewedBy: "web-admin",
        rejectionReason: "所属门店选择有误",
        reviewRound: 1,
        wechatNickname: "阿新"
      }
    ] : [],
    stores: fallbackStores,
    courses: fallbackCourses,
    phrases: fallbackPhrases,
    productRewardRules: [],
    exams: fallbackExams,
    questions: fallbackExams.flatMap((exam) => exam.questions.map((question, index) => ({
      ...question,
      examId: exam.id,
      sortOrder: (index + 1) * 10
    }))),
    submissions: fallbackSubmissions,
    caseComments: [],
    goldenBeanLedger: fallbackGoldenBeanLedger,
    rewards: fallbackRewards,
    redemptions: fallbackRedemptions,
    employeeProductTasks: [],
    storeProductSales: [],
    storeTaskRewards: [{ id: "store-task-reward-demo", productKey: "示例产品A", title: "示例产品A 1盒", description: "每完成 10 盒门店销售任务，可领取 1 盒。", itemValue: 498, threshold: 10, status: "active" }],
    storeReceipts: [],
    courseProgress: [],
    examAttempts: [],
    phrasePracticeAttempts: [],
    supplierViews: [],
    taskRewards: {
      pop: 0,
      phrase: 0,
      case: 0
    },
    dashboardStats: fallbackDashboardStats
  };
}

export async function loadAdminData(secret: string): Promise<AdminData> {
    if (isAdminDemoMode) return loadAdminDemoData(getFallbackAdminData());

    const response = await fetch(endpoint(), {
      headers: adminHeaders(secret, false)
    });

    if (!response.ok) {
      throw new Error(`Admin data request failed: ${response.status}`);
    }

    const payload = await response.json();
    if (!payload.ok || !payload.data) {
      throw new Error(payload.message || "Admin data response is invalid");
    }

    const cloudData = payload.data;

    const data = {
      brands: (cloudData.brands || []).map(normalizeId) as Brand[],
      employees: (cloudData.employees || []).map(normalizeId) as Array<Employee & EmployeeWechatBindingSummary>,
      employeeApplications: (cloudData.employeeApplications || []).map(normalizeId) as EmployeeApplication[],
      stores: (cloudData.stores || []).map(normalizeId) as Store[],
      courses: (cloudData.courses || []).map(normalizeId) as Course[],
      phrases: (cloudData.phrases || []).map(normalizeId) as Phrase[],
      productRewardRules: (cloudData.productRewardRules || []).map(normalizeId) as ProductRewardRule[],
      exams: (cloudData.exams || []).map(normalizeId) as Exam[],
      questions: (cloudData.questions || []).map(normalizeId) as Array<Question & { examId: string; sortOrder?: number }>,
      submissions: (cloudData.submissions || []).map(normalizeSubmission),
      caseComments: (cloudData.caseComments || []).map(normalizeId) as CaseComment[],
      goldenBeanLedger: (cloudData.goldenBeanLedger || []).map(normalizeId) as GoldenBeanLedgerEntry[],
      rewards: (cloudData.rewards || []).map(normalizeId) as Reward[],
      redemptions: (cloudData.redemptions || []).map(normalizeId) as Redemption[],
      employeeProductTasks: (cloudData.employeeProductTasks || []).map(normalizeId) as EmployeeProductTask[],
      storeProductSales: (cloudData.storeProductSales || []).map(normalizeId) as StoreProductSale[],
    storeTaskRewards: (cloudData.storeTaskRewards || []).map(normalizeId) as StoreTaskReward[],
      storeReceipts: (cloudData.storeReceipts || []).map(normalizeId) as StoreReceipt[],
      courseProgress: (cloudData.courseProgress || []).map(normalizeId) as CourseProgressRecord[],
      examAttempts: (cloudData.examAttempts || []).map(normalizeId) as ExamAttemptRecord[],
      phrasePracticeAttempts: (cloudData.phrasePracticeAttempts || []).map(normalizeId) as PhrasePracticeAttemptRecord[],
      supplierViews: (cloudData.supplierViews || []) as SupplierView[],
      taskRewards: cloudData.taskRewards || { pop: 0, phrase: 0, case: 0 }
    };

    return {
      source: "cloudbase",
      ...data,
      dashboardStats: cloudData.dashboardStats || buildDashboardStats(data)
    };
}

export async function reviewSubmissionAction(input: {
  secret: string;
  submissionType: ReviewSubmissionType;
  submissionId: string;
  decision: ReviewDecision;
  rejectReason?: string;
  casePrivacyConfirmed?: boolean;
  casePrivacyVersion?: string;
}) {
  if (isAdminDemoMode) return runAdminDemoAction("reviewSubmission", input);

  const response = await fetch(endpoint(), {
    method: "POST",
    headers: adminHeaders(input.secret),
    body: JSON.stringify(input)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || `Review request failed: ${response.status}`);
  }

  return payload.data;
}

export async function reviewStoreReceiptAction(input: { secret: string; receiptId: string; decision: "approved" | "rejected"; rejectReason?: string }) {
  if (isAdminDemoMode) return { receipt: { id: input.receiptId, status: input.decision } };
  const response = await fetch(endpoint(), { method: "POST", headers: adminHeaders(input.secret), body: JSON.stringify({ action: "reviewStoreReceipt", ...input }) });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.message || `Review receipt request failed: ${response.status}`);
  return payload.data;
}

export async function deleteCasePostAction(input: { secret: string; caseId: string }) {
  if (isAdminDemoMode) return runAdminDemoAction("deleteCasePost", input);

  const response = await fetch(endpoint(), {
    method: "POST",
    headers: adminHeaders(input.secret),
    body: JSON.stringify({ action: "deleteCasePost", ...input })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || `Delete case request failed: ${response.status}`);
  }
  return payload.data;
}

export async function deleteCaseCommentAction(input: { secret: string; commentId: string }) {
  if (isAdminDemoMode) return runAdminDemoAction("deleteCaseComment", input);

  const response = await fetch(endpoint(), {
    method: "POST",
    headers: adminHeaders(input.secret),
    body: JSON.stringify({ action: "deleteCaseComment", ...input })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || `Delete comment request failed: ${response.status}`);
  }
  return payload.data;
}

export async function saveCourseAction(input: {
  secret: string;
  courseId?: string;
  title: string;
  duration: string;
  description: string;
  goldenBeans: number;
  status: "draft" | "published";
  track: CourseTrack;
  productName: string;
  productImage: string;
  chronicCategory: ChronicCategory;
  coverImage: string;
  videoUrl: string;
  resourceType: "" | "pdf" | "ppt" | "doc" | "video-link";
  resourceUrl: string;
  resourceName: string;
  slideCount: number;
  slideImageFileIds: string[];
  slideImagePrefix: string;
  slideMinSeconds: number;
  pptProcessingStatus: "" | "processing" | "ready" | "failed";
  pptConversionJobId: string;
  sortOrder: number;
}) {
  if (isAdminDemoMode) return runAdminDemoAction("saveCourse", input);

  const response = await fetch(endpoint(), {
    method: "POST",
    headers: adminHeaders(input.secret),
    body: JSON.stringify({
      action: "saveCourse",
      ...input
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || `Save course request failed: ${response.status}`);
  }

  return payload.data;
}

export type PptConversionStatus = {
  jobId: string;
  status: "processing" | "ready" | "failed";
  slideCount?: number;
  slideImageFileIds?: string[];
  message?: string;
};

export async function startPptConversionAction(input: { secret: string; fileId: string }): Promise<PptConversionStatus> {
  return postAdminAction({ action: "startPptConversion", ...input }) as Promise<PptConversionStatus>;
}

export async function getPptConversionStatusAction(input: { secret: string; jobId: string }): Promise<PptConversionStatus> {
  return postAdminAction({ action: "getPptConversionStatus", ...input }) as Promise<PptConversionStatus>;
}

export async function savePhraseAction(input: {
  secret: string;
  phraseId?: string;
  title: string;
  script: string;
  productName: string;
  audioFileId?: string;
  audioUrl?: string;
  audioName?: string;
  goldenBeans: number;
  maxRewardedAttempts: number;
  status: "draft" | "published";
  sortOrder: number;
}) {
  return postAdminAction({
    action: "savePhrase",
    ...input
  });
}

export async function saveProductRewardRuleAction(input: {
  secret: string;
  productKey: string;
  productName: string;
  rewardCap: number;
  status: "active" | "inactive";
}) {
  return postAdminAction({
    action: "saveProductRewardRule",
    ...input
  });
}

export async function deleteLearningContentAction(input: {
  secret: string;
  contentType: "course" | "exam" | "phrase";
  contentId: string;
}) {
  return postAdminAction({
    action: "deleteLearningContent",
    ...input
  });
}

export async function saveCaseAction(input: {
  secret: string;
  caseId?: string;
  title: string;
  content: string;
  publisherEmployeeId?: string;
  images: Array<{
    fileId?: string;
    imageUrl?: string;
    width?: number;
    height?: number;
    size?: number;
  }>;
  videoFileId?: string;
  videoUrl?: string;
  videoDuration?: number;
  videoWidth?: number;
  videoHeight?: number;
  videoSize?: number;
  casePrivacyConfirmed: boolean;
  casePrivacyVersion: string;
  acknowledgementRequired: boolean;
  productName?: string;
  visibleSupplierIds?: string[];
}) {
  return postAdminAction({
    action: "saveCase",
    ...input
  });
}

export async function saveExamAction(input: {
  secret: string;
  examId?: string;
  title: string;
  productName: string;
  passScore: number;
  goldenBeans: number;
  status: "draft" | "published";
  sortOrder: number;
  groupKey?: string;
  subExamIndex?: number;
  totalSubExams?: number;
  questions: Array<{
    prompt: string;
    options: string[];
    type: "single" | "multiple";
    answerIndex: number;
    answerIndexes: number[];
    explanation?: string;
    sortOrder: number;
  }>;
}) {
  if (isAdminDemoMode) return runAdminDemoAction("saveExam", input);

  const response = await fetch(endpoint(), {
    method: "POST",
    headers: adminHeaders(input.secret),
    body: JSON.stringify({
      action: "saveExam",
      ...input
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || `Save exam request failed: ${response.status}`);
  }

  return payload.data;
}

export async function uploadCourseAssetAction(input: {
  secret: string;
  file: File;
  folder: string;
  onProgress?: (completedChunks: number, totalChunks: number) => void;
}) {
  if (isAdminDemoMode) return uploadAdminDemoAsset(input.file, input.folder);

  if (input.file.size > directUploadLimitBytes) {
    return uploadCourseAssetDirectly(input);
  }

  const formData = new FormData();
  formData.append("action", "uploadCourseAsset");
  formData.append("secret", input.secret);
  formData.append("folder", input.folder);
  formData.append("file", input.file);

  const response = await fetch(endpoint(), {
    method: "POST",
    headers: adminHeaders(input.secret, false),
    body: formData
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || `Upload course asset request failed: ${response.status}`);
  }

  return payload.data as UploadedAsset;
}

async function uploadCourseAssetDirectly(input: {
  secret: string;
  file: File;
  folder: string;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
}) {
  const descriptor = await postAdminAction({
    action: "createCourseAssetUpload",
    secret: input.secret,
    folder: input.folder,
    filename: input.file.name,
    contentType: input.file.type || "application/octet-stream",
    size: input.file.size
  }) as DirectUploadDescriptor;

  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", descriptor.uploadUrl, true);
    request.setRequestHeader("authorization", descriptor.authorization);
    request.setRequestHeader("x-cos-meta-fileid", descriptor.cosFileId);
    request.setRequestHeader("x-cos-security-token", descriptor.token);
    if (input.file.type) {
      request.setRequestHeader("content-type", input.file.type);
    }
    request.upload.onprogress = (event) => {
      input.onProgress?.(event.loaded, event.lengthComputable ? event.total : input.file.size);
    };
    request.onerror = () => reject(new Error("连接云存储失败，请检查网络后重试"));
    request.onabort = () => reject(new Error("上传已取消"));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        input.onProgress?.(input.file.size, input.file.size);
        resolve();
        return;
      }
      reject(new Error(`云存储上传失败：${request.status || "网络错误"}`));
    };
    request.send(input.file);
  });

  return descriptor;
}

function createUploadId(file: File) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${file.name.replace(/[^0-9a-zA-Z_-]/g, "")}`;
}

async function uploadCourseAssetChunk(input: {
  secret: string;
  folder: string;
  uploadId: string;
  chunkIndex: number;
  chunk: Blob;
}) {
  const formData = new FormData();
  formData.append("action", "uploadCourseAssetChunk");
  formData.append("secret", input.secret);
  formData.append("folder", input.folder);
  formData.append("uploadId", input.uploadId);
  formData.append("chunkIndex", String(input.chunkIndex));
  formData.append("file", input.chunk, `chunk-${String(input.chunkIndex).padStart(5, "0")}.part`);

  const response = await fetch(endpoint(), {
    method: "POST",
    headers: adminHeaders(input.secret, false),
    body: formData
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || `Upload chunk request failed: ${response.status}`);
  }

  return payload.data as { fileID: string; cloudPath: string; chunkIndex: number; size: number };
}

async function uploadCourseAssetInChunks(input: {
  secret: string;
  file: File;
  folder: string;
  onProgress?: (completedChunks: number, totalChunks: number) => void;
}) {
  const uploadId = createUploadId(input.file);
  const totalChunks = Math.ceil(input.file.size / chunkUploadSizeBytes);
  const chunks: Array<{ fileID: string; chunkIndex: number }> = new Array(totalChunks);
  const parallelism = Math.min(4, totalChunks);
  let nextChunkIndex = 0;
  let completedChunks = 0;

  async function uploadWithRetry(chunkIndex: number) {
    const start = chunkIndex * chunkUploadSizeBytes;
    const end = Math.min(input.file.size, start + chunkUploadSizeBytes);
    const chunk = input.file.slice(start, end);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await uploadCourseAssetChunk({
          secret: input.secret,
          folder: input.folder,
          uploadId,
          chunkIndex,
          chunk
        });
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error("上传分片失败");
  }

  async function worker() {
    while (nextChunkIndex < totalChunks) {
      const chunkIndex = nextChunkIndex;
      nextChunkIndex += 1;
      const result = await uploadWithRetry(chunkIndex);
      chunks[chunkIndex] = { fileID: result.fileID, chunkIndex };
      completedChunks += 1;
      input.onProgress?.(completedChunks, totalChunks);
    }
  }

  await Promise.all(Array.from({ length: parallelism }, () => worker()));

  return postAdminAction({
    action: "completeCourseAssetUpload",
    secret: input.secret,
    folder: input.folder,
      filename: input.file.name,
      contentType: input.file.type || "application/octet-stream",
    chunks
  }) as Promise<UploadedAsset>;
}

async function postAdminAction<TInput extends Record<string, unknown>>(input: TInput) {
  if (isAdminDemoMode) return runAdminDemoAction(String(input.action || ""), input);

  const response = await fetch(endpoint(), {
    method: "POST",
    headers: adminHeaders(String(input.secret || "")),
    body: JSON.stringify(input)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || `Admin action failed: ${response.status}`);
  }

  return payload.data;
}

export async function saveStoreAction(input: {
  secret: string;
  storeId?: string;
  name: string;
  regionId: string;
  brandId: string;
  storeNo: string;
  address: string;
  organizationType: "store" | "department";
  status: "active" | "inactive";
}) {
  return postAdminAction({
    action: "saveStore",
    ...input
  });
}

export async function saveEmployeeAction(input: {
  secret: string;
  employeeId?: string;
  name: string;
  employeeNo: string;
  position: string;
  role: "employee" | "storeManager" | "admin" | "supplier";
  storeId: string;
  regionId: string;
  goldenBeans: number;
  courseCompletionRate: number;
  examPassRate: number;
  status: "active" | "inactive";
  supplierName?: string;
  supplierProductKeys?: string[];
}) {
  return postAdminAction({
    action: "saveEmployee",
    ...input
  });
}

export type EmployeeImportRow = {
  rowNumber: number;
  name: string;
  brandName: string;
  storeName: string;
  position: string;
  employeeNo: string;
  role: string;
  status: string;
};

export type EmployeeImportResult = {
  committed: boolean;
  items: Array<{
    rowNumber: number;
    action: "create" | "update";
    employeeId: string;
    document: Record<string, unknown>;
  }>;
  errors: Array<{ rowNumber: number; name?: string; message: string }>;
  summary: { total: number; created: number; updated: number; skipped: number; failed: number };
};

export type EmployeeProductTaskImportRow = {
  rowNumber: number;
  name: string;
  storeName: string;
  productKey: string;
  periodKey: string;
  targetQuantity: number;
  completedQuantity: number;
  attainmentRate?: number;
};

export type EmployeeProductTaskImportResult = {
  importedCount: number;
  rejectedCount: number;
  imported: Array<Omit<EmployeeProductTaskImportRow, "rowNumber"> & { row: number; employeeId: string }>;
  rejected: Array<{ row: number; message: string }>;
};

export type StoreProductSaleImportRow = {
  rowNumber: number;
  storeName: string;
  productKey: string;
  periodKey: string;
  targetQuantity: number;
  completedQuantity: number;
  attainmentRate?: number;
};

export type StoreProductSaleImportResult = {
  importedCount: number;
  rejectedCount: number;
  imported: Array<Omit<StoreProductSaleImportRow, "rowNumber"> & { row: number; storeId: string }>;
  rejected: Array<{ row: number; message: string }>;
};

export async function importEmployeesAction(input: {
  secret: string;
  rows: EmployeeImportRow[];
  dryRun: boolean;
}) {
  return postAdminAction({
    action: "importEmployees",
    ...input
  }) as Promise<EmployeeImportResult>;
}

export async function importEmployeeProductTasksAction(input: {
  secret: string;
  rows: EmployeeProductTaskImportRow[];
}) {
  return postAdminAction({
    action: "importEmployeeProductTasks",
    ...input
  }) as Promise<EmployeeProductTaskImportResult>;
}

export async function importStoreProductSalesAction(input: {
  secret: string;
  rows: StoreProductSaleImportRow[];
}) {
  if (isAdminDemoMode) return runAdminDemoAction("importStoreProductSales", input) as Promise<StoreProductSaleImportResult>;
  return postAdminAction({
    action: "importStoreProductSales",
    ...input
  }) as Promise<StoreProductSaleImportResult>;
}

export async function clearStoreProductSalesAction(input: {
  secret: string;
  productKey: string;
  periodKey: string;
}) {
  if (isAdminDemoMode) return runAdminDemoAction("clearStoreProductSales", input) as Promise<{
    productKey: string;
    periodKey: string;
    deletedCount: number;
  }>;
  return postAdminAction({
    action: "clearStoreProductSales",
    ...input
  }) as Promise<{
    productKey: string;
    periodKey: string;
    deletedCount: number;
  }>;
}

export async function setUniformStoreProductSalesTargetAction(input: {
  secret: string;
  productKey: string;
  periodKey: string;
  targetQuantity: number;
}) {
  if (isAdminDemoMode) return runAdminDemoAction("setUniformStoreProductSalesTarget", input) as Promise<{
    productKey: string;
    periodKey: string;
    targetQuantity: number;
    affectedStoreCount: number;
    createdCount: number;
    updatedCount: number;
    excludedStoreCount: number;
    preservedCompletedQuantity: number;
  }>;
  return postAdminAction({ action: "setUniformStoreProductSalesTarget", ...input }) as Promise<{
    productKey: string;
    periodKey: string;
    targetQuantity: number;
    affectedStoreCount: number;
    createdCount: number;
    updatedCount: number;
    excludedStoreCount: number;
    preservedCompletedQuantity: number;
  }>;
}

export async function setUniformProductTaskAction(input: {
  secret: string;
  productKey: string;
  periodKey: string;
  targetQuantity: number;
}) {
  return postAdminAction({
    action: "setUniformProductTask",
    ...input
  }) as Promise<{
    productKey: string;
    periodKey: string;
    targetQuantity: number;
    affectedEmployeeCount: number;
    createdCount: number;
    updatedCount: number;
    excludedCount: number;
  }>;
}

export async function clearUniformProductTaskAction(input: {
  secret: string;
  productKey: string;
  periodKey: string;
}) {
  return postAdminAction({
    action: "clearUniformProductTask",
    ...input
  }) as Promise<{
    productKey: string;
    periodKey: string;
    deletedCount: number;
  }>;
}

export async function enforceNinetyPointExamRuleAction(input: { secret: string }) {
  return postAdminAction({
    action: "enforceNinetyPointExamRule",
    ...input
  }) as Promise<{ updatedExams: number; resetAttempts: number; passScore: number }>;
}

export async function reviewEmployeeApplicationAction(input: {
  secret: string;
  applicationId: string;
  decision: ReviewDecision;
  rejectionReason?: string;
}) {
  return postAdminAction({
    action: "reviewEmployeeApplication",
    ...input
  });
}

export async function unbindEmployeeWechatAction(input: {
  secret: string;
  employeeId: string;
}) {
  return postAdminAction({
    action: "unbindEmployeeWechat",
    ...input
  });
}

export async function resetEmployeeGoldenBeansAction(input: { secret: string; confirmation: string }) {
  return postAdminAction({
    action: "resetEmployeeGoldenBeans",
    ...input
  }) as Promise<{ employeeCount: number; resetLedgerCount: number }>;
}

export async function resetEmployeeLearningProgressAction(input: { secret: string; confirmation: string }) {
  return postAdminAction({
    action: "resetEmployeeLearningProgress",
    ...input
  }) as Promise<{
    employeeCount: number;
    deletedCourseProgress: number;
    deletedProductTasks: number;
    deletedExamAttempts: number;
    deletedPhraseAttempts: number;
  }>;
}

export async function saveTaskRewardsAction(input: {
  secret: string;
  pop: number;
  phrase: number;
  case: number;
}) {
  return postAdminAction({
    action: "saveTaskRewards",
    ...input
  });
}

export async function saveRewardAction(input: {
  secret: string;
  rewardId?: string;
  title: string;
  description: string;
  goldenBeanPrice: number;
  stock: number;
  status: "active" | "inactive";
  imageUrl: string;
  sortOrder: number;
  nonDrugConfirmed: boolean;
}) {
  return postAdminAction({
    action: "saveReward",
    ...input
  });
}

export async function saveStoreTaskRewardAction(input: {
  secret: string;
  productKey: string;
  title: string;
  description: string;
  itemValue: number;
  status: "active" | "inactive";
}) {
  if (isAdminDemoMode) return runAdminDemoAction("saveStoreTaskReward", input) as unknown as Promise<{ storeTaskReward: StoreTaskReward }>;
  return postAdminAction({ action: "saveStoreTaskReward", ...input }) as Promise<{ storeTaskReward: StoreTaskReward }>;
}

export async function fulfillRedemptionAction(input: {
  secret: string;
  redemptionId: string;
  fulfillRemark?: string;
}) {
  return postAdminAction({
    action: "fulfillRedemption",
    ...input
  });
}

export async function adjustGoldenBeansAction(input: {
  secret: string;
  employeeId: string;
  delta: number;
  reason: string;
}) {
  return postAdminAction({
    action: "adjustGoldenBeans",
    ...input
  });
}
