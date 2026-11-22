import { StrictMode } from "react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import readXlsxFile from "read-excel-file";
import { applyBrandToDocument, brandAssetUrl, brandConfig, organizationDisplayName, type Brand } from "@open-training/shared";
import {
  Award,
  BookOpen,
  ClipboardCheck,
  Download,
  FileUp,
  FileImage,
  FileSpreadsheet,
  FileText,
  Film,
  Gift,
  Image as ImageIcon,
  Heart,
  LayoutDashboard,
  LockKeyhole,
  Mic,
  MessageCircle,
  Pencil,
  Plus,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Store,
  Trophy,
  Trash2,
  Upload,
  Users,
  Volume2,
  X
} from "lucide-react";
import {
  adjustGoldenBeansAction,
  clearUniformProductTaskAction,
  deleteLearningContentAction,
  deleteCaseCommentAction,
  deleteCasePostAction,
  fulfillRedemptionAction,
  getPptConversionStatusAction,
  getFallbackAdminData,
  importEmployeesAction,
  importEmployeeProductTasksAction,
  importStoreProductSalesAction,
  clearStoreProductSalesAction,
  setUniformStoreProductSalesTargetAction,
  setUniformProductTaskAction,
  isAdminDemoMode,
  loadAdminData,
  reviewSubmissionAction,
  reviewStoreReceiptAction,
  resetEmployeeGoldenBeansAction,
  resetEmployeeLearningProgressAction,
  saveCaseAction,
  saveEmployeeAction,
  saveCourseAction,
  saveExamAction,
  savePhraseAction,
  saveProductRewardRuleAction,
  saveRewardAction,
  saveStoreTaskRewardAction,
  saveStoreAction,
  saveTaskRewardsAction,
  startPptConversionAction,
  enforceNinetyPointExamRuleAction,
  unbindEmployeeWechatAction,
  uploadCourseAssetAction,
  type AdminData,
  type ChronicCategory,
  type CourseTrack,
  type EmployeeImportResult,
  type EmployeeImportRow,
  type EmployeeProductTaskImportRow,
  type StoreProductSaleImportRow,
  type ReviewDecision
} from "./data";
import {
  employeeImportTemplate,
  employeeRecordsFromMatrix,
  parseEmployeeCsv
} from "./employeeImportCore.js";
import {
  parseProductTaskCsv,
  productTaskImportTemplate,
  productTaskRecordsFromMatrix
} from "./productTaskImportCore.js";
import {
  parseStoreProductSalesCsv,
  storeProductSalesImportTemplate,
  storeProductSalesRecordsFromMatrix
} from "./storeProductSalesImportCore.js";
import {
  examQuestionTemplate,
  parseExamQuestionDocx,
  parseExamQuestionFile,
  splitExamQuestionGroups
} from "./examImportCore.js";
import { supplierProductKeys, toggleSupplierProduct } from "./supplierProductSelectionCore.js";
import { buildEmployeeLearningAudit } from "./learningAuditCore.js";
import "./styles.css";

applyBrandToDocument("admin");
const brandLogoUrl = brandAssetUrl(brandConfig.logo);
const CASE_PRIVACY_VERSION = "case-deidentification-2026-07-30";

const reviewTypeLabel = {
  pop: "POP 上传",
  phrase: "开口说",
  case: "案例分享"
};

const statusLabel = {
  active: "启用",
  inactive: "停用",
  draft: "草稿",
  published: "已发布",
  pending: "待处理",
  approved: "已通过",
  rejected: "已驳回",
  fulfilled: "已发放"
};

const courseTrackLabel: Record<CourseTrack, string> = {
  product: "产品学习点",
  chronic: "慢病学习"
};

const chronicCategoryLabel: Record<ChronicCategory, string> = {
  diabetes: "糖尿病",
  hypertension: "高血压",
  hyperuricemia: "高尿酸",
  hyperlipidemia: "高血脂"
};

function adminIdValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (typeof value === "object") {
    const item = value as { $oid?: unknown; id?: unknown; _id?: unknown; toHexString?: () => string };
    if (typeof item.toHexString === "function") return item.toHexString().trim();
    if (typeof item.$oid === "string") return item.$oid.trim();
    if (typeof item.id === "string") return item.id.trim();
    if (typeof item._id === "string") return item._id.trim();
  }
  return String(value).trim();
}

function adminProgressCompleted(progress: AdminData["courseProgress"][number]) {
  return progress.completed === true
    || progress.videoWatchCompleted === true
    || progress.readingCompleted === true
    || Number(progress.progress || 0) >= 100;
}

function sameAdminId(left: unknown, right: unknown) {
  const leftId = adminIdValue(left);
  return Boolean(leftId) && leftId === adminIdValue(right);
}

function isWritableDataSource(source: AdminData["source"]) {
  return source === "cloudbase" || source === "demo";
}

async function waitForPptConversion(secret: string, jobId: string) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => window.setTimeout(resolve, 2000));
    const result = await getPptConversionStatusAction({ secret, jobId });
    if (result.status === "ready" || result.status === "failed") return result;
  }
  throw new Error("PPT 仍在后台处理中，请稍后编辑该课程并继续查看处理结果");
}

type CourseRecord = AdminData["courses"][number];
type ExamRecord = AdminData["exams"][number];
type QuestionRecord = AdminData["questions"][number];
type StoreRecord = AdminData["stores"][number];
type EmployeeRecord = AdminData["employees"][number] & {
  wechatBound?: boolean;
  wechatBindingCount?: number;
  wechatNickname?: string;
};
type PhraseRecord = AdminData["phrases"][number];
type ProductRewardRuleRecord = AdminData["productRewardRules"][number];

type CourseFormState = {
  courseId: string;
  title: string;
  duration: string;
  description: string;
  goldenBeans: string;
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
  slideCount: string;
  slideImageFileIds: string[];
  slideImagePrefix: string;
  slideMinSeconds: string;
  pptProcessingStatus: "" | "processing" | "ready" | "failed";
  pptConversionJobId: string;
  sortOrder: string;
};

type QuestionFormState = {
  id: string;
  prompt: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  type: "single" | "multiple";
  answerIndexes: string[];
  explanation: string;
};

type ExamFormState = {
  examId: string;
  title: string;
  productName: string;
  passScore: string;
  goldenBeans: string;
  status: "draft" | "published";
  sortOrder: string;
  questions: QuestionFormState[];
};

type ImportedExamGroupState = {
  index: number;
  title: string;
  productName: string;
  questions: QuestionFormState[];
  warnings: string[];
};

type StoreFormState = {
  storeId: string;
  name: string;
  regionId: string;
  brandId: string;
  storeNo: string;
  address: string;
  organizationType: "store" | "department";
  status: "active" | "inactive";
};

type EmployeeFormState = {
  employeeId: string;
  name: string;
  employeeNo: string;
  position: string;
  role: "employee" | "storeManager" | "admin" | "supplier";
  storeId: string;
  regionId: string;
  goldenBeans: string;
  courseCompletionRate: string;
  examPassRate: string;
  status: "active" | "inactive";
  supplierName: string;
  supplierProductKeys: string;
};

const supplierStorePlaceholder = "__supplier__";

type EmployeeImportPreviewState = {
  fileName: string;
  rows: EmployeeImportRow[];
  result: EmployeeImportResult;
};

type RewardRecord = AdminData["rewards"][number];
type RedemptionRecord = AdminData["redemptions"][number];
type StoreTaskRewardRecord = AdminData["storeTaskRewards"][number];

type RewardFormState = {
  rewardId: string;
  title: string;
  description: string;
  goldenBeanPrice: string;
  stock: string;
  status: "active" | "inactive";
  imageUrl: string;
  sortOrder: string;
  nonDrugConfirmed: boolean;
};

type StoreTaskRewardFormState = {
  productKey: string;
  title: string;
  description: string;
  itemValue: string;
  status: "active" | "inactive";
};

type GoldenBeanAdjustFormState = {
  employeeId: string;
  delta: string;
  reason: string;
};

type TaskRewardsFormState = {
  pop: string;
  phrase: string;
  case: string;
};

type PhraseFormState = {
  phraseId: string;
  title: string;
  script: string;
  productName: string;
  audioUrl: string;
  audioName: string;
  goldenBeans: string;
  maxRewardedAttempts: string;
  status: "draft" | "published";
  sortOrder: string;
};

type ProductRewardRuleFormState = {
  productKey: string;
  productName: string;
  rewardCap: string;
  status: "active" | "inactive";
};

type CaseFormState = {
  title: string;
  content: string;
  imageUrls: string[];
  videoUrl: string;
  publisherEmployeeId: string;
  privacyConfirmed: boolean;
  acknowledgementRequired: boolean;
  productName: string;
  visibleSupplierIds: string[];
};

function createEmptyCourseForm(): CourseFormState {
  return {
    courseId: "",
    title: "",
    duration: "10 分钟",
    description: "",
    goldenBeans: "0",
    status: "published",
    track: "product",
    productName: "",
    productImage: "",
    chronicCategory: "diabetes",
    coverImage: "",
    videoUrl: "",
    resourceType: "",
    resourceUrl: "",
    resourceName: "",
    slideCount: "0",
    slideImageFileIds: [],
    slideImagePrefix: "",
    slideMinSeconds: "3",
    pptProcessingStatus: "",
    pptConversionJobId: "",
    sortOrder: "100"
  };
}

function createEmptyCaseForm(): CaseFormState {
  return {
    title: "",
    content: "",
    imageUrls: [],
    videoUrl: "",
    publisherEmployeeId: "",
    privacyConfirmed: false,
    acknowledgementRequired: true,
    productName: "",
    visibleSupplierIds: []
  };
}

function createEmptyPhraseForm(): PhraseFormState {
  return {
    phraseId: "",
    title: "",
    script: "",
    productName: "",
    audioUrl: "",
    audioName: "",
    goldenBeans: "2",
    maxRewardedAttempts: "2",
    status: "published",
    sortOrder: "100"
  };
}

function createProductRewardRuleForm(rule?: ProductRewardRuleRecord): ProductRewardRuleFormState {
  return {
    productKey: rule?.productKey || "",
    productName: rule?.productName || "",
    rewardCap: String(rule?.rewardCap ?? 50),
    status: rule?.status === "inactive" ? "inactive" : "active"
  };
}

function createEmptyQuestion(index: number): QuestionFormState {
  return {
    id: `local-${Date.now()}-${index}`,
    prompt: "",
    optionA: "",
    optionB: "",
    optionC: "",
    optionD: "",
    type: "single",
    answerIndexes: ["0"],
    explanation: ""
  };
}

function createEmptyExamForm(): ExamFormState {
  return {
    examId: "",
    title: "",
    productName: "",
    passScore: "90",
    goldenBeans: "0",
    status: "published",
    sortOrder: "100",
    questions: [createEmptyQuestion(1)]
  };
}

function importedQuestionForm(question: {
  prompt: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  type: "single" | "multiple";
  answerIndexes: string[];
  explanation: string;
}, index: number): QuestionFormState {
  return {
    id: `word-import-${Date.now()}-${index}`,
    prompt: question.prompt,
    optionA: question.optionA,
    optionB: question.optionB,
    optionC: question.optionC,
    optionD: question.optionD,
    type: question.type,
    answerIndexes: question.answerIndexes.length ? question.answerIndexes : ["0"],
    explanation: question.explanation
  };
}

function createEmptyStoreForm(): StoreFormState {
  return {
    storeId: "",
    name: "",
    regionId: "default",
    brandId: "",
    storeNo: "",
    address: "",
    organizationType: "store",
    status: "active"
  };
}

function createEmptyEmployeeForm(stores: StoreRecord[] = []): EmployeeFormState {
  const firstStore = stores[0];
  return {
    employeeId: "",
    name: "",
    employeeNo: "",
    position: "",
    role: "employee",
    storeId: firstStore?.id || "",
    regionId: firstStore?.regionId || "default",
    goldenBeans: "0",
    courseCompletionRate: "0",
    examPassRate: "0",
    status: "active",
    supplierName: "",
    supplierProductKeys: ""
  };
}

function createEmptyRewardForm(): RewardFormState {
  return {
    rewardId: "",
    title: "",
    description: "",
    goldenBeanPrice: "600",
    stock: "10",
    status: "active",
    imageUrl: "",
    sortOrder: "100",
    nonDrugConfirmed: false
  };
}

function buildStoreTaskRewardForm(reward?: StoreTaskRewardRecord): StoreTaskRewardFormState {
  return {
    productKey: reward?.productKey || "示例产品A",
    title: reward?.title || "示例产品A 1盒",
    description: reward?.description || "每完成 10 盒门店销售任务，可领取 1 盒。",
    itemValue: String(reward?.itemValue ?? 498),
    status: reward?.status === "inactive" ? "inactive" : "active"
  };
}

function createEmptyGoldenBeanAdjustForm(employees: EmployeeRecord[] = []): GoldenBeanAdjustFormState {
  return {
    employeeId: employees[0]?.id || "",
    delta: "100",
    reason: "线下学习奖励"
  };
}

function buildTaskRewardsForm(taskRewards: AdminData["taskRewards"]): TaskRewardsFormState {
  return {
    pop: String(taskRewards?.pop ?? 0),
    phrase: String(taskRewards?.phrase ?? 0),
    case: String(taskRewards?.case ?? 0)
  };
}

function buildPhraseForm(phrase: PhraseRecord): PhraseFormState {
  return {
    phraseId: phrase.id,
    title: phrase.title || "",
    script: phrase.script || "",
    productName: phrase.productName || "",
    audioUrl: phrase.audioFileId || phrase.audioUrl || "",
    audioName: phrase.audioName || "",
    goldenBeans: String(phrase.goldenBeans ?? 0),
    maxRewardedAttempts: String(phrase.maxRewardedAttempts ?? 1),
    status: phrase.status === "draft" ? "draft" : "published",
    sortOrder: String(phrase.sortOrder ?? 100)
  };
}

function buildStoreForm(store: StoreRecord): StoreFormState {
  return {
    storeId: store.id,
    name: store.name || "",
    regionId: store.regionId || "default",
    brandId: store.brandId || "",
    storeNo: store.storeNo || "",
    address: store.address || "",
    organizationType: store.organizationType === "department" ? "department" : "store",
    status: store.status === "inactive" ? "inactive" : "active"
  };
}

function buildEmployeeForm(employee: EmployeeRecord, stores: StoreRecord[]): EmployeeFormState {
  const store = stores.find((item) => item.id === employee.storeId);
  return {
    employeeId: employee.id,
    name: employee.name || "",
    employeeNo: employee.employeeNo || "",
    position: employee.position || "",
    role: employee.role || "employee",
    storeId: employee.storeId || stores[0]?.id || "",
    regionId: employee.regionId || store?.regionId || "default",
    goldenBeans: String(employee.goldenBeans ?? 0),
    courseCompletionRate: String(employee.courseCompletionRate ?? 0),
    examPassRate: String(employee.examPassRate ?? 0),
    status: employee.status === "inactive" ? "inactive" : "active",
    supplierName: employee.supplierName || "",
    supplierProductKeys: (employee.supplierProductKeys || []).join(", ")
  };
}

function buildRewardForm(reward: RewardRecord): RewardFormState {
  return {
    rewardId: reward.id,
    title: reward.title || "",
    description: reward.description || "",
    goldenBeanPrice: String(reward.goldenBeanPrice ?? 0),
    stock: String(reward.stock ?? 0),
    status: reward.status === "inactive" ? "inactive" : "active",
    imageUrl: reward.imageUrl || "",
    sortOrder: String(reward.sortOrder ?? 100),
    nonDrugConfirmed: reward.nonDrugConfirmed === true
  };
}

function buildCourseForm(course: CourseRecord): CourseFormState {
  const track = course.track === "chronic" ? "chronic" : "product";
  return {
    courseId: course.id,
    title: course.title || "",
    duration: course.duration || "10 分钟",
    description: course.description || "",
    goldenBeans: String(course.goldenBeans ?? 0),
    status: course.status === "draft" ? "draft" : "published",
    track,
    productName: course.productName || "",
    productImage: course.productImage || course.productImageUrl || "",
    chronicCategory: (course.chronicCategory as ChronicCategory) || "diabetes",
    coverImage: course.coverImage || course.coverImageUrl || "",
    videoUrl: course.videoFileId || course.videoUrl || "",
    resourceType: course.resourceType || "",
    resourceUrl: course.resourceUrl || course.resourceFileId || "",
    resourceName: course.resourceName || "",
    slideCount: String(course.slideCount ?? 0),
    slideImageFileIds: Array.isArray(course.slideImageFileIds) ? course.slideImageFileIds : [],
    slideImagePrefix: course.slideImagePrefix || "",
    slideMinSeconds: String(course.slideMinSeconds ?? 3),
    pptProcessingStatus: course.pptProcessingStatus === "processing" || course.pptProcessingStatus === "failed"
      ? course.pptProcessingStatus
      : Number(course.slideCount || 0) > 0 && (Array.isArray(course.slideImageFileIds) && course.slideImageFileIds.length > 0 || course.slideImagePrefix)
        ? "ready"
        : "",
    pptConversionJobId: course.pptConversionJobId || "",
    sortOrder: String(course.sortOrder ?? 100)
  };
}

function buildExamForm(exam: ExamRecord, questions: QuestionRecord[]): ExamFormState {
  const examQuestions = questions
    .filter((question) => question.examId === exam.id)
    .sort((a, b) => Number(a.sortOrder || 999) - Number(b.sortOrder || 999));

  return {
    examId: exam.id,
    title: exam.title || "",
    productName: exam.productName || "",
    passScore: "90",
    goldenBeans: String(exam.goldenBeans ?? 0),
    status: exam.status === "draft" ? "draft" : "published",
    sortOrder: String(exam.sortOrder ?? 100),
    questions: examQuestions.length > 0
      ? examQuestions.map((question, index) => ({
        id: question.id || `question-${index}`,
        prompt: question.prompt || "",
        optionA: question.options?.[0] || "",
        optionB: question.options?.[1] || "",
        optionC: question.options?.[2] || "",
        optionD: question.options?.[3] || "",
        type: question.type === "multiple" ? "multiple" : "single",
        answerIndexes: (question.type === "multiple" ? (question.answerIndexes || []) : [question.answerIndex ?? 0])
          .map((item) => String(item)),
        explanation: question.explanation || ""
      }))
      : [createEmptyQuestion(1)]
  };
}

function getCourseTypeText(course: CourseRecord) {
  if (course.track === "chronic") {
    return chronicCategoryLabel[(course.chronicCategory as ChronicCategory) || "diabetes"] || "慢病学习";
  }

  return course.productName || "产品学习点";
}

function getResourceTypeText(course: CourseRecord) {
  return course.resourceType === "pdf"
    ? "PDF"
    : course.resourceType === "ppt"
      ? `PPT · ${Number(course.slideCount || 0)}页 · 每页${Number(course.slideMinSeconds || 3)}秒`
      : course.resourceType === "doc"
        ? "文档"
        : course.resourceType === "video-link"
          ? "视频链接"
          : course.videoUrl || course.videoFileId
            ? "视频文件"
            : "图文资料";
}

function getEmployeeName(employees: AdminData["employees"], employeeId: string) {
  return employees.find((employee) => employee.id === employeeId)?.name ?? "未知员工";
}

function getStoreName(stores: AdminData["stores"], storeId: string) {
  const store = stores.find((item) => item.id === storeId);
  return store ? organizationDisplayName(store) : "未知门店";
}

function scrollToAdminSection(id: string) {
  window.requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function auditPlatformLabel(value: string) {
  return value === "ios" ? "iOS" : value === "android" ? "安卓" : value === "harmony" ? "鸿蒙" : value === "other" ? "其他系统" : "设备未记录";
}

function auditTime(value: string) {
  if (!value) return "没有操作时间";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN", { hour12: false });
}

function EmployeeLearningAuditModal({ employee, storeName, audit, onClose }: {
  employee: EmployeeRecord;
  storeName: string;
  audit: ReturnType<typeof buildEmployeeLearningAudit>;
  onClose: () => void;
}) {
  return (
    <div className="admin-modal-backdrop" role="dialog" aria-modal="true" aria-label={`${employee.name}学习核查`} onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="learning-audit-modal">
        <header>
          <div><strong>{employee.name} · 学习核查</strong><small>{storeName} · {employee.employeeNo || "无员工编号"}</small></div>
          <button className="icon-button" type="button" aria-label="关闭学习核查" onClick={onClose}><X size={19} /></button>
        </header>
        {!audit.hasActivity ? <div className="learning-audit-empty">该账号没有任何课程、考试或开口说操作记录。</div> : null}
        <div className="learning-audit-sections">
          <section>
            <h3>课程与视频</h3>
            <div className="learning-audit-list">{audit.courseRows.map((row) => (
              <article key={row.id}>
                <span><strong>{row.title}</strong><small>{row.productName} · {auditPlatformLabel(row.platform)} · {auditTime(row.lastActivityAt)}</small></span>
                <b className={`audit-status ${row.status}`}>{row.status === "completed" ? "已完成" : row.status === "in-progress" ? `观看中 ${row.progress}%` : "从未进入"}</b>
              </article>
            ))}</div>
          </section>
          <section>
            <h3>考试</h3>
            <div className="learning-audit-list">{audit.examRows.map((row) => (
              <article key={row.id}>
                <span><strong>{row.title}</strong><small>{row.productName} · {row.attemptCount} 次记录 · {auditPlatformLabel(row.platform)} · {auditTime(row.lastActivityAt)}</small></span>
                <b className={`audit-status ${row.status}`}>{row.status === "passed" ? `已通过 ${row.score}分` : row.status === "failed" ? `未通过 ${row.score}分` : "未答题"}</b>
              </article>
            ))}</div>
          </section>
          <section>
            <h3>开口说</h3>
            <div className="learning-audit-list">{audit.phraseRows.length ? audit.phraseRows.map((row) => (
              <article key={row.id}>
                <span><strong>{row.title}</strong><small>{row.productName} · {auditPlatformLabel(row.platform)} · {auditTime(row.lastActivityAt)}</small></span>
                <b className={`audit-status ${row.status}`}>{row.status === "completed" ? `已完成 ${row.completedCount}/${row.requiredCount}` : row.status === "in-progress" ? `进行中 ${row.completedCount}/${row.requiredCount}` : "未开口说"}</b>
              </article>
            )) : <div className="empty-state">当前没有发布开口说任务</div>}</div>
          </section>
        </div>
      </section>
    </div>
  );
}

function App() {
  const [adminData, setAdminData] = useState<AdminData>(() => getFallbackAdminData());
  const [isLoading, setIsLoading] = useState(true);
  const [reviewCode, setReviewCode] = useState(() => isAdminDemoMode ? "local-demo" : sessionStorage.getItem("adminReviewCode") || "");
  const [reviewingId, setReviewingId] = useState("");
  const [moderatingId, setModeratingId] = useState("");
  const [courseForm, setCourseForm] = useState<CourseFormState>(() => createEmptyCourseForm());
  const [phraseForm, setPhraseForm] = useState<PhraseFormState>(() => createEmptyPhraseForm());
  const [productRewardRuleForm, setProductRewardRuleForm] = useState<ProductRewardRuleFormState>(() => (
    createProductRewardRuleForm(getFallbackAdminData().productRewardRules[0])
  ));
  const [caseForm, setCaseForm] = useState<CaseFormState>(() => createEmptyCaseForm());
  const [examForm, setExamForm] = useState<ExamFormState>(() => createEmptyExamForm());
  const [importedExamGroups, setImportedExamGroups] = useState<ImportedExamGroupState[]>([]);
  const [storeForm, setStoreForm] = useState<StoreFormState>(() => createEmptyStoreForm());
  const [employeeForm, setEmployeeForm] = useState<EmployeeFormState>(() => createEmptyEmployeeForm());
  const [employeeImportPreview, setEmployeeImportPreview] = useState<EmployeeImportPreviewState | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [inlineEmployeeId, setInlineEmployeeId] = useState("");
  const [inlineEmployeeForm, setInlineEmployeeForm] = useState<EmployeeFormState | null>(null);
  const [learningAuditEmployeeId, setLearningAuditEmployeeId] = useState("");
  const [rewardForm, setRewardForm] = useState<RewardFormState>(() => createEmptyRewardForm());
  const [storeTaskRewardForm, setStoreTaskRewardForm] = useState<StoreTaskRewardFormState>(() => buildStoreTaskRewardForm(getFallbackAdminData().storeTaskRewards[0]));
  const [goldenBeanAdjustForm, setGoldenBeanAdjustForm] = useState<GoldenBeanAdjustFormState>(() => createEmptyGoldenBeanAdjustForm());
  const [taskRewardsForm, setTaskRewardsForm] = useState<TaskRewardsFormState>(() => buildTaskRewardsForm(getFallbackAdminData().taskRewards));
  const [savingCourse, setSavingCourse] = useState(false);
  const [savingPhrase, setSavingPhrase] = useState(false);
  const [savingProductRewardRule, setSavingProductRewardRule] = useState(false);
  const [savingCase, setSavingCase] = useState(false);
  const [savingExam, setSavingExam] = useState(false);
  const [savingImportedExams, setSavingImportedExams] = useState(false);
  const [savingStore, setSavingStore] = useState(false);
  const [savingEmployee, setSavingEmployee] = useState(false);
  const [importingEmployees, setImportingEmployees] = useState(false);
  const [importingProductTasks, setImportingProductTasks] = useState(false);
  const [importingStoreProductSales, setImportingStoreProductSales] = useState(false);
  const [settingUniformStoreTarget, setSettingUniformStoreTarget] = useState(false);
  const [applyingNinetyPointRule, setApplyingNinetyPointRule] = useState(false);
  const [savingReward, setSavingReward] = useState(false);
  const [savingStoreTaskReward, setSavingStoreTaskReward] = useState(false);
  const [adjustingGoldenBeans, setAdjustingGoldenBeans] = useState(false);
  const [savingTaskRewards, setSavingTaskRewards] = useState(false);
  const [unbindingEmployeeId, setUnbindingEmployeeId] = useState("");
  const [resettingEmployees, setResettingEmployees] = useState<"goldenBeans" | "learning" | "">("");
  const [fulfillingRedemptionId, setFulfillingRedemptionId] = useState("");
  const [uploadingAsset, setUploadingAsset] = useState<"productImage" | "coverImage" | "videoUrl" | "resourceFile" | "phraseAudio" | "rewardImage" | "caseImage" | "caseVideo" | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [accessError, setAccessError] = useState("");

  useEffect(() => {
    if (!reviewCode) {
      setIsLoading(false);
      return undefined;
    }
    let alive = true;
    setIsLoading(true);
    setAccessError("");

    loadAdminData(reviewCode).then((data) => {
      if (alive) {
        setAdminData(data);
        setEmployeeForm((current) => current.storeId ? current : createEmptyEmployeeForm(data.stores));
        setGoldenBeanAdjustForm((current) => current.employeeId ? current : createEmptyGoldenBeanAdjustForm(data.employees));
        setTaskRewardsForm(buildTaskRewardsForm(data.taskRewards));
        setProductRewardRuleForm(createProductRewardRuleForm(data.productRewardRules[0]));
        setStoreTaskRewardForm(buildStoreTaskRewardForm(data.storeTaskRewards[0]));
        setCaseForm((current) => current.publisherEmployeeId
          ? current
          : {
              ...current,
              publisherEmployeeId: data.employees.find((employee) => employee.role === "admin")?.id || ""
            });
        setIsLoading(false);
      }
    }).catch((error) => {
      if (!alive) return;
      sessionStorage.removeItem("adminReviewCode");
      setAccessError(error instanceof Error ? error.message : "管理访问验证失败");
      setReviewCode("");
      setIsLoading(false);
    });

    return () => {
      alive = false;
    };
  }, [reviewCode]);

  async function refreshAdminData() {
    setIsLoading(true);
    try {
      const data = await loadAdminData(reviewCode);
      setAdminData(data);
      setTaskRewardsForm(buildTaskRewardsForm(data.taskRewards));
      setProductRewardRuleForm(createProductRewardRuleForm(data.productRewardRules[0]));
      setCaseForm((current) => data.employees.some((employee) => (
        employee.id === current.publisherEmployeeId && employee.role === "admin"
      ))
        ? current
        : {
            ...current,
            publisherEmployeeId: data.employees.find((employee) => employee.role === "admin")?.id || ""
          });
      return data;
    } finally {
      setIsLoading(false);
    }
  }

  function handleAdminAccess(secret: string) {
    const value = secret.trim();
    if (!value) {
      setAccessError("请输入管理访问口令");
      return;
    }
    sessionStorage.setItem("adminReviewCode", value);
    setReviewCode(value);
  }

  function handleSettings() {
    setNotice({ type: "success", message: "系统设置已按当前 CloudBase 环境生效；员工、门店和内容请使用下方对应管理模块维护。" });
  }

  function exportEmployeeRanking() {
    const rows = [
      ["排名", "姓名", "门店", "职位", "员工编号", "金豆"],
      ...topEmployees.map((employee, index) => [
        String(index + 1),
        employee.name,
        getStoreName(adminData.stores, employee.storeId),
        employee.position || "",
        employee.employeeNo,
        String(employee.goldenBeans || 0)
      ])
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${brandConfig.shortName}全员金豆排行.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice({ type: "success", message: `已导出 ${topEmployees.length} 名员工的金豆排行。` });
  }

  function exportCourseCompletionRanking() {
    const rows = [
      ["排名", "姓名", "门店", "职位", "员工编号", "课程完成率"],
      ...courseRankingEmployees.map((employee, index) => [
        String(index + 1),
        employee.name,
        getStoreName(adminData.stores, employee.storeId),
        employee.position || "",
        employee.employeeNo,
        `${Number(employee.courseCompletionRate || 0)}%`
      ])
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${brandConfig.shortName}课程达成率排行.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice({ type: "success", message: `已导出 ${courseRankingEmployees.length} 名员工的课程达成率排行。` });
  }

  async function handleReview(submission: AdminData["submissions"][number], decision: ReviewDecision) {
    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前是本地演示数据，请等待 CloudBase 数据连接后再审核。" });
      return;
    }

    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写审核码。" });
      return;
    }

    const rejectReason = decision === "rejected"
      ? window.prompt("请输入驳回原因", "资料不完整，请重新提交")?.trim()
      : "";

    if (decision === "rejected" && rejectReason === undefined) {
      return;
    }

    sessionStorage.setItem("adminReviewCode", secret);
    setReviewingId(`${submission.type}:${submission.id}`);
    setNotice(null);

    try {
      await reviewSubmissionAction({
        secret,
        submissionType: submission.type,
        submissionId: submission.id,
        decision,
        rejectReason,
        ...(submission.type === "case" && decision === "approved" ? {
          casePrivacyConfirmed: true,
          casePrivacyVersion: CASE_PRIVACY_VERSION
        } : {})
      });
      await refreshAdminData();
      setNotice({
        type: "success",
        message: decision === "approved" ? "审核已通过，金豆已按当前规则处理。" : "已驳回提交。"
      });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "审核失败"
      });
    } finally {
      setReviewingId("");
    }
  }

  async function handleDeleteCase(caseId: string) {
    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前是本地演示数据，不能删除动态。" });
      return;
    }
    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写审核码。" });
      return;
    }
    if (!window.confirm("确认删除这条案例动态？删除后员工端将不再显示。")) return;

    setModeratingId(`case:${caseId}`);
    setNotice(null);
    try {
      await deleteCasePostAction({ secret, caseId });
      await refreshAdminData();
      setNotice({ type: "success", message: "案例动态已删除。" });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "删除失败" });
    } finally {
      setModeratingId("");
    }
  }

  async function handleDeleteCaseComment(commentId: string) {
    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前是本地演示数据，不能删除评论。" });
      return;
    }
    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写审核码。" });
      return;
    }
    if (!window.confirm("确认删除这条评论？")) return;

    setModeratingId(`comment:${commentId}`);
    setNotice(null);
    try {
      await deleteCaseCommentAction({ secret, commentId });
      await refreshAdminData();
      setNotice({ type: "success", message: "评论已删除。" });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "删除失败" });
    } finally {
      setModeratingId("");
    }
  }

  function updateCourseForm(field: keyof CourseFormState, value: string) {
    setCourseForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function editCourse(course: CourseRecord) {
    setCourseForm(buildCourseForm(course));
    setNotice(null);
    scrollToAdminSection("courses");
  }

  function resetCourseForm() {
    setCourseForm(createEmptyCourseForm());
  }

  function updatePhraseForm(field: keyof PhraseFormState, value: string) {
    setPhraseForm((current) => ({ ...current, [field]: value }));
  }

  function editPhrase(phrase: PhraseRecord) {
    setPhraseForm(buildPhraseForm(phrase));
    setNotice(null);
    scrollToAdminSection("phrases");
  }

  function resetPhraseForm() {
    setPhraseForm(createEmptyPhraseForm());
  }

  function updateProductRewardRuleForm(field: keyof ProductRewardRuleFormState, value: string) {
    setProductRewardRuleForm((current) => ({ ...current, [field]: value }));
  }

  function updateCaseForm(field: keyof CaseFormState, value: string | string[]) {
    setCaseForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "imageUrls" && value.length ? { videoUrl: "" } : {}),
      ...(field === "videoUrl" && value ? { imageUrls: [] } : {})
    }));
  }

  function resetCaseForm() {
    setCaseForm({
      ...createEmptyCaseForm(),
      publisherEmployeeId: adminData.employees.find((employee) => employee.role === "admin")?.id || ""
    });
  }

  function updateExamForm(field: keyof Omit<ExamFormState, "questions">, value: string) {
    setExamForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateQuestion(index: number, field: keyof QuestionFormState, value: string) {
    setExamForm((current) => ({
      ...current,
      questions: current.questions.map((question, questionIndex) => (
        questionIndex === index ? { ...question, [field]: value } : question
      ))
    }));
  }

  function toggleQuestionAnswer(index: number, answerIndex: string) {
    setExamForm((current) => ({
      ...current,
      questions: current.questions.map((question, questionIndex) => {
        if (questionIndex !== index) {
          return question;
        }
        if (question.type === "multiple") {
          const nextAnswers = question.answerIndexes.includes(answerIndex)
            ? question.answerIndexes.filter((item) => item !== answerIndex)
            : [...question.answerIndexes, answerIndex];
          return {
            ...question,
            answerIndexes: nextAnswers.length > 0 ? nextAnswers : [answerIndex]
          };
        }
        return {
          ...question,
          answerIndexes: [answerIndex]
        };
      })
    }));
  }

  function addQuestion() {
    setExamForm((current) => ({
      ...current,
      questions: [...current.questions, createEmptyQuestion(current.questions.length + 1)]
    }));
  }

  function removeQuestion(index: number) {
    setExamForm((current) => ({
      ...current,
      questions: current.questions.length <= 1
        ? current.questions
        : current.questions.filter((_, questionIndex) => questionIndex !== index)
    }));
  }

  function editExam(exam: ExamRecord) {
    setExamForm(buildExamForm(exam, adminData.questions));
    setNotice(null);
    scrollToAdminSection("exams");
  }

  function resetExamForm() {
    setExamForm(createEmptyExamForm());
  }

  function updateImportedExamGroup(groupIndex: number, field: "title" | "productName", value: string) {
    setImportedExamGroups((current) => current.map((group, index) => (
      index === groupIndex ? { ...group, [field]: value } : group
    )));
  }

  function updateImportedQuestion(groupIndex: number, questionIndex: number, field: keyof QuestionFormState, value: string) {
    setImportedExamGroups((current) => current.map((group, index) => index === groupIndex ? {
      ...group,
      questions: group.questions.map((question, itemIndex) => itemIndex === questionIndex ? { ...question, [field]: value } : question)
    } : group));
  }

  function toggleImportedQuestionAnswer(groupIndex: number, questionIndex: number, answerIndex: string) {
    setImportedExamGroups((current) => current.map((group, index) => index === groupIndex ? {
      ...group,
      questions: group.questions.map((question, itemIndex) => {
        if (itemIndex !== questionIndex) return question;
        if (question.type === "multiple") {
          const nextAnswers = question.answerIndexes.includes(answerIndex)
            ? question.answerIndexes.filter((item) => item !== answerIndex)
            : [...question.answerIndexes, answerIndex];
          return { ...question, answerIndexes: nextAnswers.length ? nextAnswers : [answerIndex] };
        }
        return { ...question, answerIndexes: [answerIndex] };
      })
    } : group));
  }

  async function handleExamQuestionImport(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    try {
      if (file.name.toLowerCase().endsWith(".docx")) {
        const parsed = await parseExamQuestionDocx(file);
        const groups = splitExamQuestionGroups(parsed.questions, 10).map((group) => ({
          ...group,
          questions: group.questions.map((question, index) => importedQuestionForm(question, index)),
          warnings: parsed.warnings.filter((warning) => group.questions.some((question) => warning.includes(`第 ${question.number} 题`)))
        }));
        setImportedExamGroups(groups);
        setNotice({ type: "success", message: `Word 已识别 ${parsed.questions.length} 道题，已拆成 ${groups.length} 套每套 10 题的示例产品C产品评测草稿，请检查后保存。` });
        return;
      }
      const imported = parseExamQuestionFile(await file.text(), file.name);
      setExamForm((current) => ({
        ...current,
        questions: imported.map((question, index) => ({
          ...question,
          id: `imported-${Date.now()}-${index}`
        }))
      }));
      setNotice({ type: "success", message: `已导入 ${imported.length} 道题，检查后点击保存题库。` });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "答题卡导入失败" });
    }
  }

  async function handleSaveImportedExams() {
    if (!importedExamGroups.length) return;
    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前数据源不可写入，请先连接 CloudBase 或本地可编辑演示。" });
      return;
    }
    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写审核码。" });
      return;
    }
    const invalid = importedExamGroups.flatMap((group) => group.questions.map((question, index) => ({ group, question, index })))
      .find(({ question }) => !question.prompt.trim() || [question.optionA, question.optionB, question.optionC, question.optionD].filter((item) => item.trim()).length < 2 || question.answerIndexes.length === 0);
    if (invalid) {
      setNotice({ type: "error", message: `${invalid.group.title}第 ${invalid.index + 1} 题信息不完整，请补齐题干、至少两个选项和正确答案。` });
      return;
    }
    setSavingImportedExams(true);
    setNotice(null);
    try {
      const groupKey = `示例产品C-${Date.now()}`;
      for (const group of importedExamGroups) {
        await saveExamAction({
          secret,
          title: group.title.trim() || `示例产品C产品评测（${group.index}）`,
          productName: group.productName.trim() || "示例产品C",
          passScore: 90,
          goldenBeans: 0,
          status: "draft",
          sortOrder: group.index * 10,
          groupKey,
          subExamIndex: group.index,
          totalSubExams: importedExamGroups.length,
          questions: group.questions.map((question, index) => ({
            prompt: question.prompt.trim(),
            options: [question.optionA, question.optionB, question.optionC, question.optionD].map((item) => item.trim()).filter(Boolean),
            type: question.type,
            answerIndex: Number(question.answerIndexes[0] || 0),
            answerIndexes: question.answerIndexes.map(Number).filter(Number.isFinite),
            explanation: question.explanation.trim(),
            sortOrder: (index + 1) * 10
          }))
        });
      }
      await refreshAdminData();
      setImportedExamGroups([]);
      setNotice({ type: "success", message: `已保存 ${importedExamGroups.length} 套示例产品C产品评测草稿，每套 10 道题。` });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Word 题库保存失败" });
    } finally {
      setSavingImportedExams(false);
    }
  }

  function downloadExamTemplate() {
    const blob = new Blob([`\uFEFF${examQuestionTemplate()}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${brandConfig.shortName}答题卡模板.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function updateStoreForm(field: keyof StoreFormState, value: string) {
    setStoreForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function editStore(store: StoreRecord) {
    setStoreForm(buildStoreForm(store));
    setNotice(null);
    scrollToAdminSection("store-management");
  }

  function resetStoreForm() {
    setStoreForm(createEmptyStoreForm());
  }

  function updateEmployeeForm(field: keyof EmployeeFormState, value: string) {
    setEmployeeForm((current) => {
      const next = {
        ...current,
        [field]: value
      };
      if (field === "role" && value === "supplier") {
        next.position = "供应商";
        next.storeId = adminData.stores.find((item) => item.name === "供应商")?.id || supplierStorePlaceholder;
        next.regionId = "shenzhen";
      }
      if (field === "role" && value !== "supplier" && current.role === "supplier") {
        const firstStore = adminData.stores.find((item) => item.name !== "供应商" && item.organizationType !== "department");
        next.storeId = firstStore?.id || "";
        next.regionId = firstStore?.regionId || "default";
      }
      if (field === "storeId") {
        const store = adminData.stores.find((item) => item.id === value);
        next.regionId = store?.regionId || current.regionId || "default";
      }
      return next;
    });
  }

  function editEmployee(employee: EmployeeRecord) {
    setEmployeeForm(buildEmployeeForm(employee, adminData.stores));
    setNotice(null);
    scrollToAdminSection("employee-management");
  }

  function startInlineEmployeeEdit(employee: EmployeeRecord) {
    setInlineEmployeeId(employee.id);
    setInlineEmployeeForm(buildEmployeeForm(employee, adminData.stores));
    setNotice(null);
  }

  function updateInlineEmployeeForm(field: keyof EmployeeFormState, value: string) {
    setInlineEmployeeForm((current) => {
      if (!current) return current;
      const next = { ...current, [field]: value };
      if (field === "role" && value === "supplier") next.position = "供应商";
      if (field === "storeId") {
        const store = adminData.stores.find((item) => item.id === value);
        next.regionId = store?.regionId || current.regionId || "default";
      }
      return next;
    });
  }

  function cancelInlineEmployeeEdit() {
    setInlineEmployeeId("");
    setInlineEmployeeForm(null);
  }

  async function saveInlineEmployee(employee: EmployeeRecord) {
    if (!inlineEmployeeForm || inlineEmployeeId !== employee.id) return;
    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前是本地演示数据，请等待 CloudBase 数据连接后再保存员工。" });
      return;
    }
    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写审核码。" });
      return;
    }
    if (!inlineEmployeeForm.name.trim() || !inlineEmployeeForm.position.trim() || !inlineEmployeeForm.storeId) {
      setNotice({ type: "error", message: "请填写员工姓名、职位并选择门店。" });
      return;
    }
    setSavingEmployee(true);
    setNotice(null);
    try {
      await saveEmployeeAction({
        secret,
        employeeId: employee.id,
        name: inlineEmployeeForm.name.trim(),
        employeeNo: employee.employeeNo,
        position: inlineEmployeeForm.position.trim(),
        role: inlineEmployeeForm.role,
        storeId: inlineEmployeeForm.storeId,
        regionId: inlineEmployeeForm.regionId.trim() || "default",
        goldenBeans: Number(inlineEmployeeForm.goldenBeans || 0),
        courseCompletionRate: Number(inlineEmployeeForm.courseCompletionRate || 0),
        examPassRate: Number(inlineEmployeeForm.examPassRate || 0),
        status: inlineEmployeeForm.status,
        supplierName: inlineEmployeeForm.supplierName.trim(),
        supplierProductKeys: inlineEmployeeForm.supplierProductKeys.split(",").map((item) => item.trim()).filter(Boolean)
      });
      await refreshAdminData();
      cancelInlineEmployeeEdit();
      setNotice({ type: "success", message: `${employee.name} 的信息已保存。` });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "员工保存失败" });
    } finally {
      setSavingEmployee(false);
    }
  }

  function resetEmployeeForm() {
    setEmployeeForm(createEmptyEmployeeForm(adminData.stores));
  }

  function downloadEmployeeTemplate() {
    const store = adminData.stores.find((item) => item.status !== "inactive");
    const brand = adminData.brands.find((item) => item.id === store?.brandId);
    const blob = new Blob([`\uFEFF${employeeImportTemplate(brand?.name || brandConfig.name, store?.name)}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${brandConfig.shortName}员工名单模板.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadProductTaskTemplate() {
    const blob = new Blob([`\uFEFF${productTaskImportTemplate()}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${brandConfig.shortName}产品任务导入模板.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadStoreProductSalesTemplate() {
    const blob = new Blob([`\uFEFF${storeProductSalesImportTemplate()}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${brandConfig.shortName}门店产品销售导入模板.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleStoreProductSalesImportFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前不是可写入的 CloudBase 数据，不能导入门店销售。" });
      return;
    }
    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写管理访问口令。" });
      return;
    }
    setImportingStoreProductSales(true);
    setNotice(null);
    try {
      const lowerName = file.name.toLowerCase();
      let rows: StoreProductSaleImportRow[];
      if (lowerName.endsWith(".csv")) {
        rows = parseStoreProductSalesCsv(await file.text()) as StoreProductSaleImportRow[];
      } else if (lowerName.endsWith(".xlsx")) {
        rows = storeProductSalesRecordsFromMatrix(await readXlsxFile(file)) as StoreProductSaleImportRow[];
      } else {
        throw new Error("请选择 .xlsx 或 .csv 门店产品销售表");
      }
      if (!window.confirm(`确认导入 ${rows.length} 条门店产品销售数据？相同门店、产品和统计周期会更新原记录。`)) return;
      const result = await importStoreProductSalesAction({ secret, rows });
      await refreshAdminData();
      const rejectedDetails = result.rejected.slice(0, 3).map((item) => `第${item.row}行：${item.message}`).join("；");
      setNotice(result.rejectedCount > 0
        ? { type: "error", message: `已导入/更新 ${result.importedCount} 条，${result.rejectedCount} 条未导入。${rejectedDetails ? ` ${rejectedDetails}` : ""}` }
        : { type: "success", message: `门店产品销售数据已导入/更新 ${result.importedCount} 条。` });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "门店产品销售导入失败" });
    } finally {
      setImportingStoreProductSales(false);
    }
  }

  async function handleClearStoreProductSales(input: { productKey: string; periodKey: string }) {
    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前不是可写入的 CloudBase 数据，不能清除门店销售。" });
      return;
    }
    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写管理访问口令。" });
      return;
    }
    if (!window.confirm(`确认清除“${input.productKey}”${input.periodKey}的所有门店销售数据？只删除门店产品销售记录，不影响员工任务、积分或课程。`)) return;
    setNotice(null);
    try {
      const result = await clearStoreProductSalesAction({ secret, ...input });
      await refreshAdminData();
      setNotice({ type: "success", message: `已清除 ${result.deletedCount} 条“${result.productKey}”门店销售数据。` });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "清除门店产品销售数据失败" });
    }
  }

  async function handleProductTaskImportFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前不是可写入的 CloudBase 数据，不能导入任务。" });
      return;
    }
    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写管理访问口令。" });
      return;
    }
    setImportingProductTasks(true);
    setNotice(null);
    try {
      const lowerName = file.name.toLowerCase();
      let rows: EmployeeProductTaskImportRow[];
      if (lowerName.endsWith(".csv")) {
        rows = parseProductTaskCsv(await file.text()) as EmployeeProductTaskImportRow[];
      } else if (lowerName.endsWith(".xlsx")) {
        rows = productTaskRecordsFromMatrix(await readXlsxFile(file)) as EmployeeProductTaskImportRow[];
      } else {
        throw new Error("请选择 .xlsx 或 .csv 产品任务表");
      }
      if (!window.confirm(`确认导入 ${rows.length} 条产品任务？相同员工、产品和统计周期会覆盖原数据。`)) return;
      const result = await importEmployeeProductTasksAction({ secret, rows });
      await refreshAdminData();
      setNotice(result.rejectedCount > 0
        ? { type: "error", message: `已导入 ${result.importedCount} 条，${result.rejectedCount} 条未导入，请按文件行号检查。` }
        : { type: "success", message: `产品任务已导入 ${result.importedCount} 条。` });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "产品任务导入失败" });
    } finally {
      setImportingProductTasks(false);
    }
  }

  async function handleUniformProductTask(input: { productKey: string; periodKey: string; targetQuantity: number }) {
    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前不是可写入的 CloudBase 数据，不能统一设置任务。" });
      return;
    }
    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写管理访问口令。" });
      return;
    }
    const eligibleCount = adminData.employees.filter((employee) => employee.status === "active" && employee.role !== "admin" && employee.role !== "supplier" && Boolean(adminData.stores.find((store) => store.id === employee.storeId && store.status !== "inactive" && store.organizationType !== "department"))).length;
    if (!window.confirm(`确认给 ${eligibleCount} 名正常门店员工统一设置“${input.productKey}”${input.targetQuantity}盒，统计周期${input.periodKey}？已有完成数量保留，不会清零。`)) return;
    setNotice(null);
    try {
      const result = await setUniformProductTaskAction({ secret, ...input });
      await refreshAdminData();
      setNotice({ type: "success", message: `已为 ${result.affectedEmployeeCount} 名门店员工设置任务：新增 ${result.createdCount} 条，更新 ${result.updatedCount} 条。` });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "统一设置任务失败" });
    }
  }

  async function handleUniformStoreProductTarget(input: { productKey: string; periodKey: string; targetQuantity: number }) {
    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前不是可写入的数据源，不能统一设置门店销售任务。" });
      return;
    }
    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写管理访问口令。" });
      return;
    }
    const eligibleStoreCount = adminData.stores.filter((store) => store.status !== "inactive" && store.organizationType !== "department").length;
    if (!window.confirm(`确认给 ${eligibleStoreCount} 家启用实体门店统一设置“${input.productKey}”每店 ${input.targetQuantity} 盒，统计周期 ${input.periodKey}？已有完成数量会原样保留；部门、停用组织不处理。`)) return;
    setSettingUniformStoreTarget(true);
    setNotice(null);
    try {
      const result = await setUniformStoreProductSalesTargetAction({ secret, ...input });
      await refreshAdminData();
      setNotice({ type: "success", message: `已为 ${result.affectedStoreCount} 家实体门店设置目标：新增 ${result.createdCount} 条、更新 ${result.updatedCount} 条；保留完成数量合计 ${result.preservedCompletedQuantity} 盒，排除 ${result.excludedStoreCount} 个非门店组织。` });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "统一设置门店任务失败" });
    } finally {
      setSettingUniformStoreTarget(false);
    }
  }

  async function handleClearUniformProductTask(input: { productKey: string; periodKey: string }) {
    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前不是可写入的 CloudBase 数据，不能撤回统一任务。" });
      return;
    }
    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写管理访问口令。" });
      return;
    }
    if (!window.confirm(`确认撤回“${input.productKey}”${input.periodKey}的统一任务？只删除统一任务记录，不会删除课程、考试、开口说或金豆记录。`)) return;
    setNotice(null);
    try {
      const result = await clearUniformProductTaskAction({ secret, ...input });
      await refreshAdminData();
      setNotice({ type: "success", message: `已撤回 ${result.deletedCount} 条“${result.productKey}”统一任务。` });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "撤回统一任务失败" });
    }
  }

  async function handleEnforceNinetyPointRule() {
    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前不是可写入的 CloudBase 数据，不能更新考试规则。" });
      return;
    }
    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写管理访问口令。" });
      return;
    }
    if (!window.confirm("确认统一将所有考试及格线设为 90 分？历史 80-89 分的通过记录会改为待重考，已经发出的金豆不会扣回。")) return;
    setApplyingNinetyPointRule(true);
    setNotice(null);
    try {
      const result = await enforceNinetyPointExamRuleAction({ secret });
      await refreshAdminData();
      setNotice({ type: "success", message: `已更新 ${result.updatedExams} 份考试；${result.resetAttempts} 条 80-89 分记录已改为待重考。` });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "90 分规则更新失败" });
    } finally {
      setApplyingNinetyPointRule(false);
    }
  }

  async function handleEmployeeImportFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写管理访问口令。" });
      return;
    }
    setImportingEmployees(true);
    setNotice(null);
    try {
      const lowerName = file.name.toLowerCase();
      let rows: EmployeeImportRow[];
      if (lowerName.endsWith(".csv")) {
        rows = parseEmployeeCsv(await file.text());
      } else if (lowerName.endsWith(".xlsx")) {
        rows = employeeRecordsFromMatrix(await readXlsxFile(file)) as EmployeeImportRow[];
      } else {
        throw new Error("请选择 .xlsx 或 .csv 员工名单");
      }
      const result = await importEmployeesAction({ secret, rows, dryRun: true });
      setEmployeeImportPreview({ fileName: file.name, rows, result });
      setNotice(result.errors.length > 0
        ? { type: "error", message: `预检发现 ${result.errors.length} 行错误，请修改文件后重新选择。` }
        : { type: "success", message: `预检完成：新增 ${result.summary.created} 人，更新 ${result.summary.updated} 人。确认后才会写入。` });
    } catch (error) {
      setEmployeeImportPreview(null);
      setNotice({ type: "error", message: error instanceof Error ? error.message : "员工名单读取失败" });
    } finally {
      setImportingEmployees(false);
    }
  }

  async function handleConfirmEmployeeImport() {
    if (!employeeImportPreview || employeeImportPreview.result.errors.length > 0) return;
    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写管理访问口令。" });
      return;
    }
    setImportingEmployees(true);
    setNotice(null);
    try {
      const result = await importEmployeesAction({ secret, rows: employeeImportPreview.rows, dryRun: false });
      await refreshAdminData();
      setEmployeeImportPreview(null);
      setNotice({ type: "success", message: `员工名单已导入：新增 ${result.summary.created} 人，更新 ${result.summary.updated} 人。` });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "员工名单导入失败" });
    } finally {
      setImportingEmployees(false);
    }
  }

  function updateRewardForm(field: keyof RewardFormState, value: string | boolean) {
    setRewardForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function editReward(reward: RewardRecord) {
    setRewardForm(buildRewardForm(reward));
    setNotice(null);
    scrollToAdminSection("rewards");
  }

  function resetRewardForm() {
    setRewardForm(createEmptyRewardForm());
  }

  function updateStoreTaskRewardForm(field: keyof StoreTaskRewardFormState, value: string) {
    setStoreTaskRewardForm((current) => ({ ...current, [field]: value }));
  }

  function editStoreTaskReward(reward: StoreTaskRewardRecord) {
    setStoreTaskRewardForm(buildStoreTaskRewardForm(reward));
    setNotice(null);
    scrollToAdminSection("rewards");
  }

  function updateGoldenBeanAdjustForm(field: keyof GoldenBeanAdjustFormState, value: string) {
    setGoldenBeanAdjustForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateTaskRewardsForm(field: keyof TaskRewardsFormState, value: string) {
    setTaskRewardsForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function handleSaveStore(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前是本地演示数据，请等待 CloudBase 数据连接后再保存门店。" });
      return;
    }

    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写审核码。" });
      return;
    }
    if (!storeForm.name.trim()) {
      setNotice({ type: "error", message: "请填写门店名称。" });
      return;
    }

    sessionStorage.setItem("adminReviewCode", secret);
    setSavingStore(true);
    setNotice(null);

    try {
      await saveStoreAction({
        secret,
        storeId: storeForm.storeId || undefined,
        name: storeForm.name.trim(),
        regionId: storeForm.regionId.trim() || "default",
        brandId: storeForm.brandId || adminData.brands.find((brand) => brand.status !== "inactive")?.id || "",
        storeNo: storeForm.storeNo.trim(),
        address: storeForm.address.trim(),
        organizationType: storeForm.organizationType,
        status: storeForm.status
      });
      await refreshAdminData();
      resetStoreForm();
      setNotice({ type: "success", message: "组织已保存，H5 登录选择列表会同步更新。" });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "门店保存失败"
      });
    } finally {
      setSavingStore(false);
    }
  }

  async function handleSaveEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前是本地演示数据，请等待 CloudBase 数据连接后再保存员工。" });
      return;
    }

    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写审核码。" });
      return;
    }
    if (!employeeForm.name.trim() || !employeeForm.employeeNo.trim() || !employeeForm.position.trim() || (employeeForm.role !== "supplier" && !employeeForm.storeId)) {
      setNotice({ type: "error", message: "请填写员工姓名、编号、职位并选择门店。" });
      return;
    }

    sessionStorage.setItem("adminReviewCode", secret);
    setSavingEmployee(true);
    setNotice(null);

    try {
      await saveEmployeeAction({
        secret,
        employeeId: employeeForm.employeeId || undefined,
        name: employeeForm.name.trim(),
        employeeNo: employeeForm.employeeNo.trim(),
        position: employeeForm.position.trim(),
        role: employeeForm.role,
        storeId: employeeForm.role === "supplier" ? supplierStorePlaceholder : employeeForm.storeId,
        regionId: employeeForm.regionId.trim() || "default",
        goldenBeans: Number(employeeForm.goldenBeans || 0),
        courseCompletionRate: Number(employeeForm.courseCompletionRate || 0),
        examPassRate: Number(employeeForm.examPassRate || 0),
        status: employeeForm.status,
        supplierName: employeeForm.supplierName.trim(),
        supplierProductKeys: employeeForm.supplierProductKeys.split(",").map((item) => item.trim()).filter(Boolean)
      });
      await refreshAdminData();
      resetEmployeeForm();
      setNotice({ type: "success", message: "员工已保存，H5 可按组织和姓名登录。" });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "员工保存失败"
      });
    } finally {
      setSavingEmployee(false);
    }
  }

  async function handleUnbindEmployeeWechat(employee: EmployeeRecord) {
    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前是本地演示数据，不能解绑微信。" });
      return;
    }

    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写审核码。" });
      return;
    }

    const confirmed = window.confirm(`确认解绑 ${employee.name} 的微信登录吗？员工之后需要重新登录绑定。`);
    if (!confirmed) {
      return;
    }

    sessionStorage.setItem("adminReviewCode", secret);
    setUnbindingEmployeeId(employee.id);
    setNotice(null);

    try {
      const data = await unbindEmployeeWechatAction({
        secret,
        employeeId: employee.id
      });
      await refreshAdminData();
      setNotice({ type: "success", message: `已解绑 ${data.unboundCount || 0} 个微信账号。` });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "解绑失败"
      });
    } finally {
      setUnbindingEmployeeId("");
    }
  }

  async function handleResetEmployeeData(kind: "goldenBeans" | "learning") {
    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前是本地演示数据，不能清零云端员工数据。" });
      return;
    }
    const label = kind === "goldenBeans" ? "积分" : "课程达成率及学习记录";
    const confirmation = window.prompt(`此操作将清零所有启用员工的${label}，不会删除员工、门店、课程资料、案例、兑换记录或微信绑定。\n请输入“确认清零”继续：`);
    if (confirmation !== "确认清零") {
      if (confirmation !== null) setNotice({ type: "error", message: "确认文字不正确，未执行清零。" });
      return;
    }
    if (!window.confirm(`请再次确认：确定清零所有启用员工的${label}吗？`)) return;
    setResettingEmployees(kind);
    setNotice(null);
    try {
      if (kind === "goldenBeans") {
        const result = await resetEmployeeGoldenBeansAction({ secret: reviewCode.trim(), confirmation });
        await refreshAdminData();
        setNotice({ type: "success", message: `已清零 ${result.employeeCount} 名启用员工的积分。` });
        return;
      }
      const result = await resetEmployeeLearningProgressAction({ secret: reviewCode.trim(), confirmation });
      await refreshAdminData();
      setNotice({ type: "success", message: `已清零 ${result.employeeCount} 名员工的学习达成数据（课程 ${result.deletedCourseProgress} 条、任务 ${result.deletedProductTasks} 条、考试 ${result.deletedExamAttempts} 条、开口说 ${result.deletedPhraseAttempts} 条）。` });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "清零失败" });
    } finally {
      setResettingEmployees("");
    }
  }

  async function handleSaveReward(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前是本地演示数据，请等待 CloudBase 数据连接后再保存兑换商品。" });
      return;
    }

    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写审核码。" });
      return;
    }
    if (!rewardForm.title.trim()) {
      setNotice({ type: "error", message: "请填写商品名称。" });
      return;
    }
    if (!rewardForm.nonDrugConfirmed) {
      setNotice({ type: "error", message: "请确认该礼品不是药品、非处方药、处方药或医疗器械。" });
      return;
    }

    sessionStorage.setItem("adminReviewCode", secret);
    setSavingReward(true);
    setNotice(null);

    try {
      await saveRewardAction({
        secret,
        rewardId: rewardForm.rewardId || undefined,
        title: rewardForm.title.trim(),
        description: rewardForm.description.trim(),
        goldenBeanPrice: Number(rewardForm.goldenBeanPrice || 0),
        stock: Number(rewardForm.stock || 0),
        status: rewardForm.status,
        imageUrl: rewardForm.imageUrl.trim(),
        sortOrder: Number(rewardForm.sortOrder || 999),
        nonDrugConfirmed: rewardForm.nonDrugConfirmed
      });
      await refreshAdminData();
      resetRewardForm();
      setNotice({
        type: "success",
        message: isAdminDemoMode
          ? "礼品已保存到本地后台；正式上云后会同步到员工端。"
          : "兑换商品已保存，H5 金豆兑换页会同步更新。"
      });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "兑换商品保存失败"
      });
    } finally {
      setSavingReward(false);
    }
  }

  async function handleSaveStoreTaskReward(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前是本地只读数据，不能保存门店任务兑换品。" });
      return;
    }
    const secret = reviewCode.trim();
    const itemValue = Number(storeTaskRewardForm.itemValue);
    if (!secret) {
      setNotice({ type: "error", message: "请先填写管理访问口令。" });
      return;
    }
    if (!storeTaskRewardForm.productKey.trim() || !storeTaskRewardForm.title.trim()) {
      setNotice({ type: "error", message: "请选择产品并填写商品名称。" });
      return;
    }
    if (!Number.isFinite(itemValue) || itemValue < 0) {
      setNotice({ type: "error", message: "商品价值必须为非负金额。" });
      return;
    }
    setSavingStoreTaskReward(true);
    setNotice(null);
    try {
      await saveStoreTaskRewardAction({
        secret,
        productKey: storeTaskRewardForm.productKey.trim(),
        title: storeTaskRewardForm.title.trim(),
        description: storeTaskRewardForm.description.trim(),
        itemValue,
        status: storeTaskRewardForm.status
      });
      await refreshAdminData();
      setNotice({ type: "success", message: isAdminDemoMode ? "门店任务兑换品已保存到本地演示后台。" : "门店任务兑换品已保存，员工端将按门店销售额度显示。" });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "保存门店任务兑换品失败" });
    } finally {
      setSavingStoreTaskReward(false);
    }
  }

  async function handleFulfillRedemption(redemption: RedemptionRecord) {
    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前是本地演示数据，不能确认发放。" });
      return;
    }

    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写审核码。" });
      return;
    }

    const employeeName = getEmployeeName(adminData.employees, redemption.employeeId);
    const rewardTitle = redemption.rewardTitle || adminData.rewards.find((reward) => reward.id === redemption.rewardId)?.title || "兑换商品";
    const confirmed = window.confirm(`确认已向 ${employeeName} 发放「${rewardTitle}」吗？`);
    if (!confirmed) {
      return;
    }

    sessionStorage.setItem("adminReviewCode", secret);
    setFulfillingRedemptionId(redemption.id);
    setNotice(null);

    try {
      await fulfillRedemptionAction({
        secret,
        redemptionId: redemption.id
      });
      await refreshAdminData();
      setNotice({ type: "success", message: "兑换记录已标记为已发放。" });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "确认发放失败"
      });
    } finally {
      setFulfillingRedemptionId("");
    }
  }

  async function handleAdjustGoldenBeans(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前是本地演示数据，请等待 CloudBase 数据连接后再调整金豆。" });
      return;
    }

    const secret = reviewCode.trim();
    const delta = Number(goldenBeanAdjustForm.delta);
    const employee = adminData.employees.find((item) => item.id === goldenBeanAdjustForm.employeeId);
    const reason = goldenBeanAdjustForm.reason.trim();

    if (!secret) {
      setNotice({ type: "error", message: "请先填写审核码。" });
      return;
    }
    if (!employee) {
      setNotice({ type: "error", message: "请选择员工。" });
      return;
    }
    if (!Number.isFinite(delta) || delta === 0) {
      setNotice({ type: "error", message: "调整数量必须是非 0 数字，增加填正数，扣减填负数。" });
      return;
    }
    if (!reason) {
      setNotice({ type: "error", message: "请填写调整原因。" });
      return;
    }

    const confirmed = window.confirm(`确认给 ${employee.name} ${delta > 0 ? "增加" : "扣减"} ${Math.abs(delta)} 金豆吗？\n原因：${reason}`);
    if (!confirmed) {
      return;
    }

    sessionStorage.setItem("adminReviewCode", secret);
    setAdjustingGoldenBeans(true);
    setNotice(null);

    try {
      const data = await adjustGoldenBeansAction({
        secret,
        employeeId: employee.id,
        delta,
        reason
      });
      await refreshAdminData();
      setGoldenBeanAdjustForm((current) => ({
        ...current,
        delta: "100",
        reason: "线下学习奖励"
      }));
      setNotice({ type: "success", message: `金豆已调整，当前余额 ${data.nextGoldenBeans}。` });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "金豆调整失败"
      });
    } finally {
      setAdjustingGoldenBeans(false);
    }
  }

  async function handleSaveTaskRewards(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前是本地演示数据，请等待 CloudBase 数据连接后再保存任务金豆。" });
      return;
    }

    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写审核码。" });
      return;
    }

    sessionStorage.setItem("adminReviewCode", secret);
    setSavingTaskRewards(true);
    setNotice(null);

    try {
      await saveTaskRewardsAction({
        secret,
        pop: Number(taskRewardsForm.pop || 0),
        phrase: Number(taskRewardsForm.phrase || 0),
        case: Number(taskRewardsForm.case || 0)
      });
      await refreshAdminData();
      setNotice({ type: "success", message: "任务金豆已保存，H5 提交模块会同步更新。" });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "任务金豆保存失败"
      });
    } finally {
      setSavingTaskRewards(false);
    }
  }

  async function handleSaveCase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前是本地演示数据，请等待 CloudBase 数据连接后再发布案例。" });
      return;
    }

    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写审核码。" });
      return;
    }

    const content = caseForm.content.trim();
    if (!content) {
      setNotice({ type: "error", message: "请填写案例内容。" });
      return;
    }
    if (!caseForm.privacyConfirmed) {
      setNotice({ type: "error", message: "请完成顾客隐私检查后再发布案例。" });
      return;
    }

    sessionStorage.setItem("adminReviewCode", secret);
    setSavingCase(true);
    setNotice(null);

    try {
      const videoUrl = caseForm.videoUrl.trim();
      const publisherEmployeeId = caseForm.publisherEmployeeId
        || adminData.employees.find((employee) => employee.role === "admin")?.id
        || "";
      if (!publisherEmployeeId) {
        throw new Error("请先在员工名单中设置一个管理员账号");
      }
      await saveCaseAction({
        secret,
        title: caseForm.title.trim(),
        content,
        publisherEmployeeId,
        images: caseForm.imageUrls.map((imageUrl) => ({
          fileId: imageUrl.startsWith("cloud://") || imageUrl.startsWith("cloudbase://") ? imageUrl : "",
          imageUrl: imageUrl.startsWith("cloud://") || imageUrl.startsWith("cloudbase://") ? "" : imageUrl
        })),
        videoFileId: videoUrl.startsWith("cloud://") ? videoUrl : "",
        videoUrl: videoUrl.startsWith("cloud://") ? "" : videoUrl,
        acknowledgementRequired: caseForm.acknowledgementRequired,
        productName: caseForm.productName.trim(),
        visibleSupplierIds: caseForm.visibleSupplierIds,
        casePrivacyConfirmed: true,
        casePrivacyVersion: CASE_PRIVACY_VERSION
      });
      await refreshAdminData();
      resetCaseForm();
      setNotice({ type: "success", message: "案例已由学习运营台发布，员工端刷新后可见。" });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "案例发布失败"
      });
    } finally {
      setSavingCase(false);
    }
  }

  async function handleSaveCourse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前是本地演示数据，请等待 CloudBase 数据连接后再保存课程。" });
      return;
    }

    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写审核码。" });
      return;
    }

    if (!courseForm.title.trim()) {
      setNotice({ type: "error", message: "请填写课程标题。" });
      return;
    }

    if (courseForm.track === "product" && !courseForm.productName.trim()) {
      setNotice({ type: "error", message: "产品学习点需要填写产品名称。" });
      return;
    }

    if (
      courseForm.status === "published"
      && courseForm.resourceType === "ppt"
      && !(
        courseForm.slideImageFileIds.length > 0
        || (Number(courseForm.slideCount || 0) > 0 && courseForm.slideImagePrefix.trim())
      )
    ) {
      setNotice({ type: "error", message: courseForm.pptProcessingStatus === "processing" ? "PPT 正在自动处理，请处理完成后再发布。" : "PPT 页面尚未生成，请重新上传 PPT 后等待自动处理完成。" });
      return;
    }

    sessionStorage.setItem("adminReviewCode", secret);
    setSavingCourse(true);
    setNotice(null);

    try {
      await saveCourseAction({
        secret,
        courseId: courseForm.courseId || undefined,
        title: courseForm.title.trim(),
        duration: courseForm.duration.trim() || "10 分钟",
        description: courseForm.description.trim(),
        goldenBeans: Number(courseForm.goldenBeans || 0),
        status: courseForm.status,
        track: courseForm.track,
        productName: courseForm.productName.trim(),
        productImage: courseForm.productImage.trim(),
        chronicCategory: courseForm.chronicCategory,
        coverImage: courseForm.coverImage.trim(),
        videoUrl: courseForm.videoUrl.trim(),
        resourceType: courseForm.resourceType,
        resourceUrl: courseForm.resourceUrl.trim(),
        resourceName: courseForm.resourceName.trim(),
        slideCount: Number(courseForm.slideCount || 0),
        slideImageFileIds: courseForm.slideImageFileIds,
        slideImagePrefix: courseForm.slideImagePrefix.trim(),
        slideMinSeconds: 3,
        pptProcessingStatus: courseForm.pptProcessingStatus,
        pptConversionJobId: courseForm.pptConversionJobId,
        sortOrder: Number(courseForm.sortOrder || 999)
      });
      await refreshAdminData();
      resetCourseForm();
      setNotice({ type: "success", message: "课程已保存，H5 会按新分类展示。" });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "课程保存失败"
      });
    } finally {
      setSavingCourse(false);
    }
  }

  async function handleSavePhrase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const secret = reviewCode.trim();
    if (!isWritableDataSource(adminData.source) || !secret) {
      setNotice({ type: "error", message: !isWritableDataSource(adminData.source) ? "当前是本地演示数据。" : "请先填写审核码。" });
      return;
    }
    if (!phraseForm.title.trim() || !phraseForm.script.trim() || !phraseForm.productName.trim()) {
      setNotice({ type: "error", message: "请填写金句标题、标准话术和产品名称。" });
      return;
    }

    sessionStorage.setItem("adminReviewCode", secret);
    setSavingPhrase(true);
    setNotice(null);
    try {
      await savePhraseAction({
        secret,
        phraseId: phraseForm.phraseId || undefined,
        title: phraseForm.title.trim(),
        script: phraseForm.script.trim(),
        productName: phraseForm.productName.trim(),
        audioFileId: phraseForm.audioUrl.startsWith("cloud://") || phraseForm.audioUrl.startsWith("demo-media:") ? phraseForm.audioUrl : "",
        audioUrl: phraseForm.audioUrl.startsWith("cloud://") || phraseForm.audioUrl.startsWith("demo-media:") ? "" : phraseForm.audioUrl.trim(),
        audioName: phraseForm.audioName.trim(),
        goldenBeans: Number(phraseForm.goldenBeans),
        maxRewardedAttempts: Number(phraseForm.maxRewardedAttempts),
        status: phraseForm.status,
        sortOrder: Number(phraseForm.sortOrder)
      });
      await refreshAdminData();
      resetPhraseForm();
      setNotice({ type: "success", message: "金句规则已保存，H5 会读取最新分值和次数。" });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "金句保存失败" });
    } finally {
      setSavingPhrase(false);
    }
  }

  async function handleSaveProductRewardRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const secret = reviewCode.trim();
    if (!isWritableDataSource(adminData.source) || !secret) {
      setNotice({ type: "error", message: !isWritableDataSource(adminData.source) ? "当前是本地演示数据。" : "请先填写审核码。" });
      return;
    }

    setSavingProductRewardRule(true);
    setNotice(null);
    try {
      await saveProductRewardRuleAction({
        secret,
        productKey: productRewardRuleForm.productKey.trim(),
        productName: productRewardRuleForm.productName.trim(),
        rewardCap: Number(productRewardRuleForm.rewardCap),
        status: productRewardRuleForm.status
      });
      await refreshAdminData();
      setNotice({ type: "success", message: "产品金豆上限已保存。" });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "产品规则保存失败" });
    } finally {
      setSavingProductRewardRule(false);
    }
  }

  async function handleDeleteLearningContent(
    contentType: "course" | "exam" | "phrase",
    contentId: string,
    title: string
  ) {
    const secret = reviewCode.trim();
    if (!isWritableDataSource(adminData.source) || !secret) {
      setNotice({ type: "error", message: !isWritableDataSource(adminData.source) ? "当前是本地演示数据。" : "请先填写审核码。" });
      return;
    }
    if (!window.confirm(`确认删除“${title}”？历史学习记录和金豆流水会保留。`)) {
      return;
    }

    setModeratingId(`${contentType}:${contentId}`);
    setNotice(null);
    try {
      await deleteLearningContentAction({ secret, contentType, contentId });
      await refreshAdminData();
      if (contentType === "course" && courseForm.courseId === contentId) resetCourseForm();
      if (contentType === "exam" && examForm.examId === contentId) resetExamForm();
      if (contentType === "phrase" && phraseForm.phraseId === contentId) resetPhraseForm();
      setNotice({ type: "success", message: "学习内容已删除，历史奖励记录未变。" });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "删除失败" });
    } finally {
      setModeratingId("");
    }
  }

  async function handleSaveExam(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前是本地演示数据，请等待 CloudBase 数据连接后再保存题库。" });
      return;
    }

    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写审核码。" });
      return;
    }
    if (!examForm.productName.trim()) {
      setNotice({ type: "error", message: "请填写产品名称。" });
      return;
    }

    const questions = examForm.questions.map((question, index) => ({
      prompt: question.prompt.trim(),
      options: [question.optionA, question.optionB, question.optionC, question.optionD].map((item) => item.trim()).filter(Boolean),
      type: question.type,
      answerIndex: Number(question.answerIndexes[0] || 0),
      answerIndexes: question.answerIndexes.map(Number).filter(Number.isFinite),
      explanation: question.explanation.trim(),
      sortOrder: (index + 1) * 10
    }));

    if (questions.some((question) => !question.prompt || question.options.length < 2)) {
      setNotice({ type: "error", message: "每道题必须填写题干，且至少填写 2 个选项。" });
      return;
    }

    sessionStorage.setItem("adminReviewCode", secret);
    setSavingExam(true);
    setNotice(null);

    try {
      await saveExamAction({
        secret,
        examId: examForm.examId || undefined,
        title: examForm.title.trim() || `${examForm.productName.trim()}产品答题`,
        productName: examForm.productName.trim(),
        passScore: Number(examForm.passScore || 80),
        goldenBeans: Number(examForm.goldenBeans || 0),
        status: examForm.status,
        sortOrder: Number(examForm.sortOrder || 999),
        questions
      });
      await refreshAdminData();
      resetExamForm();
      setNotice({ type: "success", message: "产品题库已保存，H5 会显示最新题目。" });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "题库保存失败"
      });
    } finally {
      setSavingExam(false);
    }
  }

  async function handleAssetUpload(field: "productImage" | "coverImage" | "videoUrl" | "resourceFile" | "phraseAudio" | "rewardImage" | "caseImage" | "caseVideo", fileList: FileList | null) {
    const selectedFiles = Array.from(fileList || []);
    const file = selectedFiles[0];
    if (!file) {
      return;
    }

    if (field === "caseImage") {
      if (caseForm.imageUrls.length + selectedFiles.length > 9) {
        setNotice({ type: "error", message: "每条案例最多上传 9 张图片。" });
        return;
      }
      if (selectedFiles.some((item) => !item.type.startsWith("image/"))) {
        setNotice({ type: "error", message: "案例图片请选择有效的图片文件。" });
        return;
      }
      if (selectedFiles.some((item) => item.size > 32 * 1024 * 1024)) {
        setNotice({ type: "error", message: "单张案例图片不能超过 32 MB。" });
        return;
      }
    }

    if (field === "rewardImage" && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setNotice({ type: "error", message: "礼品图片仅支持 JPG、PNG 或 WebP。" });
      return;
    }
    if (field === "rewardImage" && file.size > 5 * 1024 * 1024) {
      setNotice({ type: "error", message: "礼品图片不能超过 5 MB。" });
      return;
    }

    if (!isWritableDataSource(adminData.source)) {
      setNotice({ type: "error", message: "当前是本地演示数据，请等待 CloudBase 数据连接后再上传素材。" });
      return;
    }

    const secret = reviewCode.trim();
    if (!secret) {
      setNotice({ type: "error", message: "请先填写审核码。" });
      return;
    }

    sessionStorage.setItem("adminReviewCode", secret);
    setUploadingAsset(field);
    setNotice(file.size > 3 * 1024 * 1024
      ? { type: "success", message: "视频正在直传云存储，请保持页面打开，上传完成后再保存课程。" }
      : null);

    try {
      if (field === "caseImage") {
        const uploaded: string[] = [];
        for (let index = 0; index < selectedFiles.length; index += 1) {
          const currentFile = selectedFiles[index];
          setNotice({ type: "success", message: `正在上传案例图片 ${index + 1}/${selectedFiles.length}，请保持页面打开。` });
          const result = await uploadCourseAssetAction({
            secret,
            file: currentFile,
            folder: "admin-cases/images"
          });
          uploaded.push(result.fileID || result.url);
        }
        setCaseForm((current) => ({
          ...current,
          imageUrls: [...current.imageUrls, ...uploaded].slice(0, 9),
          videoUrl: ""
        }));
        setNotice({ type: "success", message: `已上传 ${uploaded.length} 张案例图片，可继续添加或删除后发布。` });
        return;
      }
      const data = await uploadCourseAssetAction({
        secret,
        file,
        onProgress: (uploadedBytes, totalBytes) => {
          const percentage = totalBytes > 0 ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)) : 0;
          setNotice({
            type: "success",
            message: `正在上传：${percentage}%，请保持页面打开。`
          });
        },
        folder: field === "videoUrl"
          ? "admin-courses/videos"
          : field === "phraseAudio"
            ? "admin-phrases/audio"
          : field === "resourceFile"
            ? "admin-courses/resources"
          : field === "caseVideo"
            ? "admin-cases/videos"
          : field === "rewardImage"
            ? "admin-rewards/images"
            : "admin-courses/images"
      });
      if (field === "caseVideo") {
        updateCaseForm("videoUrl", data.fileID || data.url);
      } else if (field === "rewardImage") {
        updateRewardForm("imageUrl", isAdminDemoMode ? data.url || data.fileID : data.fileID || data.url);
      } else if (field === "phraseAudio") {
        updatePhraseForm("audioUrl", data.fileID || data.url);
        updatePhraseForm("audioName", file.name);
      } else if (field === "resourceFile") {
        const lowerName = file.name.toLowerCase();
        const resourceType = lowerName.endsWith(".pdf")
          ? "pdf"
          : /\.pptx?$/.test(lowerName)
            ? "ppt"
            : "doc";
        updateCourseForm("resourceType", resourceType);
        updateCourseForm("resourceUrl", data.fileID || data.url);
        updateCourseForm("resourceName", file.name);
        if (resourceType === "ppt") {
          const fileId = data.fileID || data.url;
          setCourseForm((current) => ({
            ...current,
            resourceType: "ppt",
            resourceUrl: fileId,
            resourceName: file.name,
            slideCount: "0",
            slideImageFileIds: [],
            slideImagePrefix: "",
            slideMinSeconds: "3",
            pptProcessingStatus: "processing",
            pptConversionJobId: ""
          }));
          setNotice({ type: "success", message: "PPT 已上传，正在自动识别页数并生成页面，请保持页面打开。" });
          const conversion = await startPptConversionAction({ secret, fileId });
          setCourseForm((current) => ({ ...current, pptConversionJobId: conversion.jobId }));
          const result = await waitForPptConversion(secret, conversion.jobId);
          if (result.status === "failed") {
            setCourseForm((current) => ({ ...current, pptProcessingStatus: "failed" }));
            throw new Error(result.message || "PPT 自动处理失败，请重新导出为 .pptx 后上传");
          }
          const slideImageFileIds = result.slideImageFileIds || [];
          if (!slideImageFileIds.length) throw new Error("PPT 页面生成不完整，请重新上传");
          setCourseForm((current) => ({
            ...current,
            slideCount: String(result.slideCount || slideImageFileIds.length),
            slideImageFileIds,
            slideMinSeconds: "3",
            pptProcessingStatus: "ready",
            pptConversionJobId: conversion.jobId
          }));
          setNotice({ type: "success", message: `PPT 处理完成，共 ${result.slideCount || slideImageFileIds.length} 页，每页固定学习 3 秒。` });
          return;
        }
      } else {
        updateCourseForm(field, data.fileID || data.url);
      }
      setNotice({ type: "success", message: "素材已上传，保存后生效。" });
    } catch (error) {
      if (field === "resourceFile" && /\.pptx?$/i.test(file.name)) {
        setCourseForm((current) => ({ ...current, pptProcessingStatus: "failed" }));
      }
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "素材上传失败"
      });
    } finally {
      setUploadingAsset(null);
    }
  }

  if (!reviewCode) {
    return <AdminAccessView error={accessError} onSubmit={handleAdminAccess} />;
  }

  if (isLoading && !isWritableDataSource(adminData.source)) {
    return <AdminLoadingView />;
  }

  const {
    courses,
    caseComments,
    dashboardStats,
    employees,
    exams,
    goldenBeanLedger,
    phrases,
    redemptions,
    rewards,
    stores,
    submissions
  } = adminData;
  const supplierViews = adminData.supplierViews || [];
  const pendingSubmissions = submissions.filter((item) => item.status === "pending" && !item.deletedAt);
  const caseSubmissions = submissions
    .filter((item) => item.type === "case" && !item.deletedAt)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const staffEmployees = employees.filter((employee) => employee.role !== "supplier");
  const suppliers = employees.filter((employee) => employee.role === "supplier");
  const supplierProducts = [...new Set([
    ...courses.map((item) => item.productName || ""),
    ...phrases.map((item) => item.productName || ""),
    ...exams.map((item) => item.productName || ""),
    ...adminData.employeeProductTasks.map((item) => item.productKey || "")
  ].map((item) => item.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const topEmployees = [...staffEmployees].sort((a, b) => b.goldenBeans - a.goldenBeans);
  const courseRankingEmployees = [...staffEmployees].sort((a, b) => (
    Number(b.courseCompletionRate || 0) - Number(a.courseCompletionRate || 0)
    || b.goldenBeans - a.goldenBeans
    || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN")
  ));
  const incompleteEmployees = courseRankingEmployees.filter((employee) => Number(employee.courseCompletionRate || 0) < 100);
  const normalizedEmployeeSearch = employeeSearch.trim().toLocaleLowerCase("zh-CN");
  const filteredEmployees = normalizedEmployeeSearch
    ? employees.filter((employee) => {
        const storeName = getStoreName(stores, employee.storeId);
        return [employee.name, employee.employeeNo, employee.position, storeName, employee.wechatNickname]
          .some((value) => String(value || "").toLocaleLowerCase("zh-CN").includes(normalizedEmployeeSearch));
      })
    : employees;
  const learningAuditEmployee = employees.find((employee) => employee.id === learningAuditEmployeeId) || null;
  const learningAudit = learningAuditEmployee ? buildEmployeeLearningAudit({
    employeeId: learningAuditEmployee.id,
    courses,
    courseProgress: adminData.courseProgress,
    exams,
    examAttempts: adminData.examAttempts,
    phrases,
    phrasePracticeAttempts: adminData.phrasePracticeAttempts
  }) : null;
  const courseUploadingAsset = uploadingAsset === "rewardImage"
    || uploadingAsset === "caseImage"
    || uploadingAsset === "caseVideo"
    || uploadingAsset === "phraseAudio"
    ? null
    : uploadingAsset;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src={brandLogoUrl} alt="" />
          <div>
            <strong>{brandConfig.shortName}</strong>
            <span>{brandConfig.adminSubtitle}</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="后台导航">
          <a className="active" href="#dashboard"><LayoutDashboard size={18} />概览</a>
          <a href="#employees"><Users size={18} />员工</a>
          <a href="#product-tasks"><ClipboardCheck size={18} />任务进度</a>
          <a href="#courses"><BookOpen size={18} />课程</a>
          {brandConfig.features.speaking ? <a href="#phrases"><Mic size={18} />开口说</a> : null}
          <a href="#exams"><ClipboardCheck size={18} />考试</a>
          <a href="#reviews"><FileImage size={18} />审核</a>
          <a href="#case-moderation"><MessageCircle size={18} />案例资料</a>
          {brandConfig.features.rewards ? <a href="#golden-beans"><Trophy size={18} />金豆</a> : null}
          {brandConfig.features.rewards ? <a href="#rewards"><Gift size={18} />兑换</a> : null}
        </nav>
      </aside>

      <main className="workspace">
        {notice ? (
          <div className={`global-notice ${notice.type}`} role="status" aria-live="polite">
            <span>{notice.message}</span>
            <button aria-label="关闭提示" onClick={() => setNotice(null)} type="button">×</button>
          </div>
        ) : null}
        <header className="topbar">
          <div>
            <p className="eyebrow">{brandConfig.shortName}</p>
            <h1>{brandConfig.adminSubtitle}</h1>
          </div>
          <div className="top-actions">
            <span className={`source-pill ${adminData.source}`}>
              {isLoading ? "正在读取数据" : adminData.source === "cloudbase" ? "CloudBase 数据" : adminData.source === "demo" ? "本地可编辑演示" : "本地演示数据"}
            </span>
            <label className="search">
              <Search size={16} />
              <input value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} placeholder="搜索员工、课程、门店" />
            </label>
            <button className="icon-button" aria-label="设置" onClick={handleSettings} title="设置"><Settings2 size={18} /></button>
          </div>
        </header>

        <section className="stats-grid" id="dashboard">
          <StatCard icon={<Users size={20} />} label="员工数" value={dashboardStats.totalEmployees} detail="总部预录入名单" />
          <StatCard icon={<BookOpen size={20} />} label="课程完成率" value={`${dashboardStats.averageCompletion}%`} detail="平均完成进度" />
          <StatCard icon={<ClipboardCheck size={20} />} label="考试通过率" value={`${dashboardStats.examPassRate}%`} detail="已发布考试" />
          <StatCard icon={<Award size={20} />} label="已发金豆" value={dashboardStats.issuedGoldenBeans} detail={`${dashboardStats.pendingReviews} 个待审核`} />
        </section>

        <section className="content-grid">
          <Panel id="reviews" title="待审核任务" action="刷新" onAction={refreshAdminData}>
            <div className="review-toolbar">
              <p className="admin-session-status"><LockKeyhole size={15} />管理访问已验证</p>
              {notice ? <p className={`notice ${notice.type}`}>{notice.message}</p> : null}
            </div>
            <div className="review-list">
              {pendingSubmissions.length === 0 ? (
                <div className="empty-state">暂无待审核内容</div>
              ) : (
                pendingSubmissions.map((item) => {
                  const isReviewing = reviewingId === `${item.type}:${item.id}`;

                  return (
                    <article className="review-card" key={item.id}>
                      <div className="review-icon">
                        {item.type === "phrase" ? <Mic size={18} /> : <FileImage size={18} />}
                      </div>
                      <div>
                        <h3>{item.title}</h3>
                        <p>{reviewTypeLabel[item.type]} · {getEmployeeName(employees, item.employeeId)} · {getStoreName(stores, item.storeId)}</p>
                      </div>
                      <span className="bean-pill">+{item.goldenBeans} 金豆</span>
                      <div className="review-actions">
                        <button disabled={isReviewing} onClick={() => handleReview(item, "approved")}>
                          {isReviewing ? "处理中" : "通过"}
                        </button>
                        <button className="ghost" disabled={isReviewing} onClick={() => handleReview(item, "rejected")}>
                          驳回
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </Panel>

          <Panel title="金豆排行榜" action="导出" onAction={exportEmployeeRanking}>
            <div className="ranking-list">
              {topEmployees.map((employee, index) => (
                <div className="ranking-row" key={employee.id}>
                  <span className="rank">{index + 1}</span>
                  <div>
                    <strong>{employee.name}</strong>
                    <p>{getStoreName(stores, employee.storeId)} · {employee.employeeNo}</p>
                  </div>
                  <b>{employee.goldenBeans}</b>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="课程达成率排行榜" action="导出" onAction={exportCourseCompletionRanking}>
            <div className="ranking-list">
              {courseRankingEmployees.map((employee, index) => {
                const completion = Math.max(0, Math.min(100, Number(employee.courseCompletionRate || 0)));
                return (
                  <div className="ranking-row course-ranking-row" key={employee.id}>
                    <span className="rank">{index + 1}</span>
                    <div className="course-ranking-copy">
                      <strong>{employee.name}</strong>
                      <p>{getStoreName(stores, employee.storeId)} · {employee.employeeNo}</p>
                      <div className="completion-track" aria-label={`${employee.name} 课程完成率 ${completion}%`}>
                        <span style={{ width: `${completion}%` }} />
                      </div>
                    </div>
                    <b>{completion}%</b>
                  </div>
                );
              })}
            </div>
            <div className="unfinished-block">
              <div className="unfinished-heading">
                <strong>未完成员工</strong>
                <span>课程完成率低于 100%</span>
              </div>
              <div className="unfinished-list">
                {incompleteEmployees.length ? (
                  incompleteEmployees.slice(0, 10).map((employee) => (
                    <article className="unfinished-row" key={employee.id}>
                      <div>
                        <strong>{employee.name}</strong>
                        <p>{getStoreName(stores, employee.storeId)} · {employee.position || "未填写职位"}</p>
                      </div>
                      <b>{Math.max(0, Math.min(100, Number(employee.courseCompletionRate || 0)))}%</b>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">全部员工都已完成课程</div>
                )}
              </div>
            </div>
          </Panel>
        </section>

        <section className="table-section" id="case-moderation">
          <SectionHeader
            icon={<MessageCircle size={19} />}
            title="案例资料管理"
            subtitle="由后台统一发布员工可查看的案例资料"
          />
          <form className="course-form case-publish-form" onSubmit={handleSaveCase}>
            <label>
              <span>发布管理员</span>
              <select
                value={caseForm.publisherEmployeeId}
                onChange={(event) => updateCaseForm("publisherEmployeeId", event.target.value)}
              >
                <option value="">请选择管理员</option>
                {employees.filter((employee) => employee.role === "admin" && employee.status === "active").map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>案例标题</span>
              <input
                value={caseForm.title}
                onChange={(event) => updateCaseForm("title", event.target.value)}
                placeholder="例如：门店陈列执行案例"
              />
            </label>
            <label>
              <span>案例内容</span>
              <textarea
                value={caseForm.content}
                onChange={(event) => updateCaseForm("content", event.target.value)}
                placeholder="填写案例经过、执行方法和学习重点"
                rows={4}
              />
            </label>
            <div className="form-row compact">
              <label>
                <span>关联产品（供应商权限依据）</span>
                <select value={caseForm.productName} onChange={(event) => updateCaseForm("productName", event.target.value)}>
                  <option value="">不关联产品（供应商不可见）</option>
                  {[...new Set([...courses.map((course) => course.productName || ""), ...phrases.map((phrase) => phrase.productName || ""), ...exams.map((exam) => exam.productName || "")].filter(Boolean))].map((product) => <option key={product} value={product}>{product}</option>)}
                </select>
              </label>
              <label>
                <span>可见供应商（可多选）</span>
                <select multiple value={caseForm.visibleSupplierIds} onChange={(event) => updateCaseForm("visibleSupplierIds", Array.from(event.target.selectedOptions, (option) => option.value) as any)}>
                  {employees.filter((employee) => employee.role === "supplier" && employee.status === "active").map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name} · {supplier.supplierName || "未填写厂家"}</option>)}
                </select>
              </label>
            </div>
            <CaseImageInput
              values={caseForm.imageUrls}
              isUploading={uploadingAsset === "caseImage"}
              onUpload={(files) => handleAssetUpload("caseImage", files)}
              onRemove={(index) => setCaseForm((current) => ({ ...current, imageUrls: current.imageUrls.filter((_, imageIndex) => imageIndex !== index) }))}
            />
            <AssetInput
              icon={<Film size={15} />}
              label="案例视频"
              value={caseForm.videoUrl}
              accept="video/*"
              isUploading={uploadingAsset === "caseVideo"}
              onChange={(value) => updateCaseForm("videoUrl", value)}
              onUpload={(files) => handleAssetUpload("caseVideo", files)}
            />
            <label className="admin-compliance-confirm"><input type="checkbox" checked={caseForm.acknowledgementRequired} onChange={(event) => setCaseForm((current) => ({ ...current, acknowledgementRequired: event.target.checked }))} /><span>要求员工和管理员确认收到；发布后显示未接收提醒，并计入任务接收率。</span></label>
            <label className="admin-compliance-confirm"><input type="checkbox" checked={caseForm.privacyConfirmed} onChange={(event) => setCaseForm((current) => ({ ...current, privacyConfirmed: event.target.checked }))} /><span>我已检查并确认：案例不含顾客姓名、脸部、手机号、身份证、处方、病历、诊断结果、付款信息或其他可识别顾客的信息。</span></label>
            <div className="course-form-actions">
              <button disabled={savingCase || uploadingAsset === "caseImage" || uploadingAsset === "caseVideo"} type="submit">
                <Save size={15} />{savingCase ? "发布中" : "发布案例"}
              </button>
              <button className="ghost" onClick={resetCaseForm} type="button">
                <Plus size={15} />清空
              </button>
            </div>
          </form>
          <div className="case-admin-list">
            {caseSubmissions.length === 0 ? (
              <div className="empty-state">暂无案例动态</div>
            ) : caseSubmissions.map((item) => {
              const comments = caseComments.filter((comment) => comment.caseId === item.id && !comment.deletedAt);
              const isReviewing = reviewingId === `${item.type}:${item.id}`;
              const isDeleting = moderatingId === `case:${item.id}`;
              return (
                <article className="case-admin-card" key={item.id}>
                  <div className="case-admin-head">
                    <div>
                      <h3>{item.publisherName || getEmployeeName(employees, item.employeeId)}</h3>
                      <p>{item.publisherRole === "admin" ? "后台统一发布" : getStoreName(stores, item.storeId)} · {new Date(item.createdAt).toLocaleString("zh-CN")}</p>
                    </div>
                    <div className="case-admin-status">
                      <Badge>{statusLabel[item.status]}</Badge>
                      {item.publisherRole === "admin"
                        ? <span className="bean-pill">官方资料</span>
                        : <span className="bean-pill">{item.goldenBeans > 0 ? `+${item.goldenBeans} 金豆` : "不奖励金豆"}</span>}
                    </div>
                  </div>
                  <p className="case-admin-content">{item.content || item.title}</p>
                  <p className={`privacy-review-flag ${item.casePrivacyConfirmed ? "confirmed" : "missing"}`}><ShieldCheck size={15} />{item.casePrivacyConfirmed ? "发布者已完成顾客数据脱敏确认" : "未记录脱敏确认，审核通过前必须逐项检查"}</p>
                  {item.images?.length ? (
                    <div className="case-admin-images">
                      {item.images.map((image, index) => (
                        <a href={image.url || image.imageUrl} target="_blank" rel="noreferrer" key={image.fileId || `${item.id}-${index}`}>
                          <img src={image.url || image.imageUrl} alt={`案例图片 ${index + 1}`} />
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {item.videoUrl ? (
                    <video className="case-admin-video" controls preload="metadata" src={item.videoUrl} />
                  ) : null}
                  <div className="case-admin-stats">
                    <span><Heart size={15} />{item.likeCount || 0} 个赞</span>
                    <span><MessageCircle size={15} />{item.commentCount || comments.length} 条评论</span>
                  </div>
                  {comments.length ? (
                    <div className="case-admin-comments">
                      {comments.map((comment) => (
                        <div className="case-admin-comment" key={comment.id}>
                          <p><strong>{getEmployeeName(employees, comment.employeeId)}</strong>：{comment.content}</p>
                          <button
                            aria-label="删除评论"
                            title="删除评论"
                            disabled={moderatingId === `comment:${comment.id}`}
                            onClick={() => handleDeleteCaseComment(comment.id)}
                            type="button"
                          ><Trash2 size={15} /></button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="case-admin-actions">
                    {item.status === "pending" ? (
                      <>
                        <button disabled={isReviewing} onClick={() => handleReview(item, "approved")} type="button">
                          {isReviewing ? "处理中" : "审核通过"}
                        </button>
                        <button className="secondary" disabled={isReviewing} onClick={() => handleReview(item, "rejected")} type="button">审核不通过</button>
                      </>
                    ) : null}
                    <button className="danger" disabled={isDeleting} onClick={() => handleDeleteCase(item.id)} type="button">
                      <Trash2 size={15} />{isDeleting ? "删除中" : "删除动态"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="table-section" id="employees">
          <SectionHeader icon={<Store size={19} />} title="组织与员工名单" subtitle="维护 H5 登录可选择的门店、部门和员工" />
          <div className="people-management-grid">
            <StoreManagementPanel
              storeForm={storeForm}
              stores={stores}
              brands={adminData.brands}
              isSaving={savingStore}
              onChange={updateStoreForm}
              onEdit={editStore}
              onReset={resetStoreForm}
              onSave={handleSaveStore}
            />
            <EmployeeManagementPanel
              employeeForm={employeeForm}
              employees={employees}
              stores={stores}
              products={supplierProducts}
              isSaving={savingEmployee}
              importPreview={employeeImportPreview}
              isImporting={importingEmployees}
              onChange={updateEmployeeForm}
              onCancelImport={() => setEmployeeImportPreview(null)}
              onConfirmImport={handleConfirmEmployeeImport}
              onDownloadTemplate={downloadEmployeeTemplate}
              onEdit={editEmployee}
              onImportFile={handleEmployeeImportFile}
              onReset={resetEmployeeForm}
              onSave={handleSaveEmployee}
            />
          </div>
          <section className="resource-panel supplier-management-panel" id="supplier-management">
            <SectionHeader icon={<ShieldCheck size={18} />} title="供应商管理" subtitle="供应商使用独立账号，不进入员工排行榜；在员工名单中新增“供应商”即可配置。" />
            <div className="supplier-management-note">供应商姓名下方会显示厂家/产品备注；新增或编辑供应商时，从系统已有产品列表勾选授权范围。只有授权产品的课程、测评、录音、案例和员工达成率会在供应商端显示。</div>
            <div className="resource-list compact-list">
              {suppliers.length ? suppliers.map((supplier) => (
                <article className="resource-row course-row" key={supplier.id}>
                  <div><strong>{supplier.name}</strong><p>供应商｜{supplier.supplierName || "未填写厂家"} · 授权：{(supplier.supplierProductKeys || []).join("、") || "尚未授权产品"}</p></div>
                  <button className="row-action" onClick={() => editEmployee(supplier)} type="button"><Pencil size={14} />编辑授权</button>
                </article>
              )) : <div className="empty-state">暂无供应商账号，请在上方员工名单表单选择“供应商”新增。</div>}
            </div>
            <div className="supplier-metrics-list">
              {supplierViews.length ? supplierViews.map((supplier) => (
                <details className="supplier-metrics-card" key={supplier.supplierId}>
                  <summary>
                    <span><strong>{supplier.supplierName}</strong><small>{supplier.supplierLabel} · {supplier.wechatBound ? `已绑定微信${supplier.wechatNickname ? `（${supplier.wechatNickname}）` : ""}` : "未绑定微信"}</small></span>
                    <b>{supplier.products.length} 个授权产品</b>
                  </summary>
                  <div className="supplier-product-metrics">
                    {supplier.products.length ? supplier.products.map((product) => (
                      <article className="supplier-product-card" key={`${supplier.supplierId}-${product.productKey}`}>
                        <header><div><strong>{product.productName}</strong><small>仅统计该产品的员工学习、录音、考试达成</small></div><b>平均 {product.averageCompletionRate}%</b></header>
                        {product.employees.length ? (
                          <div className="supplier-employee-metrics">
                            {product.employees.map((employee) => (
                              <div className="supplier-employee-metric" key={employee.id}>
                                <span><strong>{employee.name}</strong><small>{employee.store || getStoreName(stores, employee.storeId)} · {employee.position || "未填写职位"}</small></span>
                                <b>{employee.completionRate}%</b>
                              </div>
                            ))}
                          </div>
                        ) : <div className="empty-state">暂无可统计的员工</div>}
                      </article>
                    )) : <div className="empty-state">尚未授权产品，供应商端不会显示任何产品达成率。</div>}
                  </div>
                </details>
              )) : null}
            </div>
          </section>
          <div className="employee-table-toolbar">
            <label className="employee-search-field">
              <Search size={16} />
              <input
                value={employeeSearch}
                onChange={(event) => setEmployeeSearch(event.target.value)}
                placeholder="按姓名、员工编号、门店或职位搜索"
                aria-label="搜索员工"
              />
            </label>
            <div className="employee-reset-actions">
              <button
                className="secondary"
                disabled={Boolean(resettingEmployees)}
                onClick={() => handleResetEmployeeData("goldenBeans")}
                type="button"
              >
                {resettingEmployees === "goldenBeans" ? "清零中" : "一键清零积分"}
              </button>
              <button
                className="danger"
                disabled={Boolean(resettingEmployees)}
                onClick={() => handleResetEmployeeData("learning")}
                type="button"
              >
                {resettingEmployees === "learning" ? "清零中" : "一键清零课程达成率"}
              </button>
            </div>
          </div>
          <div className="table-card employee-table-card">
            <table>
              <thead>
                <tr>
                  <th>员工</th>
                  <th>职位</th>
                  <th>门店</th>
                  <th>课程完成</th>
                  <th>考试通过</th>
                  <th>金豆</th>
                  <th>微信绑定</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.length === 0 ? (
                  <tr><td colSpan={9}><div className="empty-state">没有找到匹配的员工</div></td></tr>
                ) : filteredEmployees.map((employee) => {
                  const isInlineEditing = inlineEmployeeId === employee.id && inlineEmployeeForm;
                  return (
                    <tr key={employee.id} className={isInlineEditing ? "inline-editing-row" : ""}>
                      <td>
                        {isInlineEditing ? (
                          <div className="inline-employee-cell"><input value={inlineEmployeeForm.name} onChange={(event) => updateInlineEmployeeForm("name", event.target.value)} aria-label={`${employee.name} 姓名`} /><span>{employee.employeeNo}</span></div>
                        ) : <><strong>{employee.name}</strong><span>{employee.employeeNo}</span></>}
                      </td>
                      <td>{isInlineEditing ? <div className="inline-position-cell"><input value={inlineEmployeeForm.position} onChange={(event) => updateInlineEmployeeForm("position", event.target.value)} aria-label="职位" /><select value={inlineEmployeeForm.role} onChange={(event) => updateInlineEmployeeForm("role", event.target.value)} aria-label="角色"><option value="employee">员工</option><option value="storeManager">店长</option><option value="admin">管理员</option><option value="supplier">供应商</option></select></div> : employee.position || "未填写"}</td>
                      <td>{isInlineEditing ? <select value={inlineEmployeeForm.storeId} onChange={(event) => updateInlineEmployeeForm("storeId", event.target.value)} aria-label="所属门店">{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select> : getStoreName(stores, employee.storeId)}</td>
                      <td>{isInlineEditing ? <input className="inline-number-input" inputMode="numeric" value={inlineEmployeeForm.courseCompletionRate} onChange={(event) => updateInlineEmployeeForm("courseCompletionRate", event.target.value)} aria-label="课程完成率" /> : `${employee.courseCompletionRate}%`}</td>
                      <td>{isInlineEditing ? <input className="inline-number-input" inputMode="numeric" value={inlineEmployeeForm.examPassRate} onChange={(event) => updateInlineEmployeeForm("examPassRate", event.target.value)} aria-label="考试通过率" /> : `${employee.examPassRate}%`}</td>
                      <td>{isInlineEditing ? <input className="inline-number-input" inputMode="numeric" value={inlineEmployeeForm.goldenBeans} onChange={(event) => updateInlineEmployeeForm("goldenBeans", event.target.value)} aria-label="金豆" /> : employee.goldenBeans}</td>
                      <td><Badge>{employee.wechatBound ? `已绑定${employee.wechatBindingCount && employee.wechatBindingCount > 1 ? `（${employee.wechatBindingCount}）` : ""}` : "未绑定"}</Badge>{employee.wechatBound && employee.wechatNickname ? <small className="wechat-binding-name">{employee.wechatNickname}</small> : null}</td>
                      <td>{isInlineEditing ? <select value={inlineEmployeeForm.status} onChange={(event) => updateInlineEmployeeForm("status", event.target.value)} aria-label="员工状态"><option value="active">启用</option><option value="inactive">停用</option></select> : <Badge>{statusLabel[employee.status]}</Badge>}</td>
                      <td>
                        <div className="table-actions">
                          {isInlineEditing ? <><button disabled={savingEmployee} onClick={() => saveInlineEmployee(employee)} type="button">{savingEmployee ? "保存中" : "保存"}</button><button className="ghost" disabled={savingEmployee} onClick={cancelInlineEmployeeEdit} type="button">取消</button></> : <button onClick={() => employee.role === "supplier" ? editEmployee(employee) : startInlineEmployeeEdit(employee)} type="button">{employee.role === "supplier" ? "编辑授权" : "编辑"}</button>}
                          {employee.role !== "supplier" ? <button className="ghost" onClick={() => setLearningAuditEmployeeId(employee.id)} type="button">学习核查</button> : null}
                          <button disabled={unbindingEmployeeId === employee.id || Boolean(isInlineEditing)} onClick={() => handleUnbindEmployeeWechat(employee)} type="button">{unbindingEmployeeId === employee.id ? "解绑中" : "解绑微信"}</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {learningAuditEmployee && learningAudit ? (
            <EmployeeLearningAuditModal
              employee={learningAuditEmployee}
              storeName={getStoreName(stores, learningAuditEmployee.storeId)}
              audit={learningAudit}
              onClose={() => setLearningAuditEmployeeId("")}
            />
          ) : null}
        </section>

        <ProductTaskProgressPanel
          employees={staffEmployees}
          stores={stores}
          courses={courses}
          phrases={phrases}
          exams={exams}
          employeeProductTasks={adminData.employeeProductTasks}
          storeProductSales={adminData.storeProductSales}
          courseProgress={adminData.courseProgress}
          examAttempts={adminData.examAttempts}
          phrasePracticeAttempts={adminData.phrasePracticeAttempts}
          isImporting={importingProductTasks}
          isImportingStoreProductSales={importingStoreProductSales}
          isSettingUniformStoreTarget={settingUniformStoreTarget}
          isApplyingNinetyPointRule={applyingNinetyPointRule}
          onDownloadTemplate={downloadProductTaskTemplate}
          onImportFile={handleProductTaskImportFile}
          onDownloadStoreSalesTemplate={downloadStoreProductSalesTemplate}
          onImportStoreSalesFile={handleStoreProductSalesImportFile}
          onClearStoreSales={handleClearStoreProductSales}
          onUniformTask={handleUniformProductTask}
          onUniformStoreTask={handleUniformStoreProductTarget}
          onClearUniformTask={handleClearUniformProductTask}
          onEnforceNinetyPointRule={handleEnforceNinetyPointRule}
        />

        <StoreReceiptReviewPanel
          receipts={adminData.storeReceipts}
          stores={stores}
          reviewCode={reviewCode}
          onReviewed={async () => { await refreshAdminData(); }}
          onNotice={setNotice}
        />

        <section className="management-grid">
          <CourseManagementPanel
            courses={courses}
            courseForm={courseForm}
            isSaving={savingCourse}
            uploadingAsset={courseUploadingAsset}
            onChange={updateCourseForm}
            onEdit={editCourse}
            onDelete={(course) => handleDeleteLearningContent("course", course.id, course.title)}
            onReset={resetCourseForm}
            onSave={handleSaveCourse}
            onAssetUpload={handleAssetUpload}
          />
          <PhraseManagementPanel
            phrases={phrases}
            form={phraseForm}
            isSaving={savingPhrase}
            onChange={updatePhraseForm}
            onEdit={editPhrase}
            onDelete={(phrase) => handleDeleteLearningContent("phrase", phrase.id, phrase.title)}
            onReset={resetPhraseForm}
            onSave={handleSavePhrase}
            uploadingAudio={uploadingAsset === "phraseAudio"}
            onAudioUpload={(files) => handleAssetUpload("phraseAudio", files)}
          />
          <ExamManagementPanel
            exams={exams}
            questions={adminData.questions}
            examForm={examForm}
            importedExamGroups={importedExamGroups}
            isSavingImportedExams={savingImportedExams}
            isSaving={savingExam}
            onChange={updateExamForm}
            onQuestionChange={updateQuestion}
            onToggleAnswer={toggleQuestionAnswer}
            onAddQuestion={addQuestion}
            onRemoveQuestion={removeQuestion}
            onEdit={editExam}
            onDelete={(exam) => handleDeleteLearningContent("exam", exam.id, exam.title)}
            onReset={resetExamForm}
            onSave={handleSaveExam}
            onImport={handleExamQuestionImport}
            onImportedGroupChange={updateImportedExamGroup}
            onImportedQuestionChange={updateImportedQuestion}
            onImportedToggleAnswer={toggleImportedQuestionAnswer}
            onSaveImported={handleSaveImportedExams}
            onClearImported={() => setImportedExamGroups([])}
            onDownloadTemplate={downloadExamTemplate}
          />
          <RewardManagementPanel
            rewardForm={rewardForm}
            rewards={rewards}
            isSaving={savingReward}
            uploadingImage={uploadingAsset === "rewardImage"}
            onChange={updateRewardForm}
            onEdit={editReward}
            onReset={resetRewardForm}
            onSave={handleSaveReward}
            onImageUpload={(files) => handleAssetUpload("rewardImage", files)}
          />
          <StoreTaskRewardManagementPanel
            form={storeTaskRewardForm}
            products={[...new Set([
              ...courses.filter((item) => (item.track || "product") === "product").map((item) => item.productName || ""),
              ...phrases.map((item) => item.productName || ""),
              ...exams.map((item) => item.productName || ""),
              ...adminData.storeProductSales.map((item) => item.productKey),
              ...adminData.storeTaskRewards.map((item) => item.productKey)
            ].map((item) => String(item).trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-CN"))}
            rewards={adminData.storeTaskRewards}
            isSaving={savingStoreTaskReward}
            onChange={updateStoreTaskRewardForm}
            onEdit={editStoreTaskReward}
            onSave={handleSaveStoreTaskReward}
          />
        </section>

        <section className="content-grid" id="golden-beans">
          <Panel title="任务奖励设置" action="跳转设置" onAction={() => document.getElementById("golden-beans")?.scrollIntoView({ behavior: "smooth" })}>
            <TaskRewardsPanel
              form={taskRewardsForm}
              isSaving={savingTaskRewards}
              onChange={updateTaskRewardsForm}
              onSave={handleSaveTaskRewards}
            />
            <ProductRewardRulePanel
              form={productRewardRuleForm}
              isSaving={savingProductRewardRule}
              onChange={updateProductRewardRuleForm}
              onSave={handleSaveProductRewardRule}
            />
          </Panel>
          <Panel title="金豆流水" action="调整金豆">
            <GoldenBeanAdjustPanel
              employees={employees}
              form={goldenBeanAdjustForm}
              isSaving={adjustingGoldenBeans}
              onChange={updateGoldenBeanAdjustForm}
              onSave={handleAdjustGoldenBeans}
            />
            <div className="ledger-list">
              {goldenBeanLedger.map((entry) => (
                <div className="ledger-row" key={entry.id}>
                  <div>
                    <strong>{getEmployeeName(employees, entry.employeeId)}</strong>
                    <p>{entry.reason} · {entry.createdAt}</p>
                  </div>
                  <b className={Number(entry.delta) < 0 ? "negative-amount" : ""}>
                    {Number(entry.delta) > 0 ? "+" : ""}{entry.delta}
                  </b>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="兑换记录" action="刷新" onAction={refreshAdminData}>
            <div className="ledger-list">
              {redemptions.map((item) => {
                const reward = rewards.find((record) => record.id === item.rewardId);
                const rewardTitle = item.rewardTitle || reward?.title || "未知奖励";
                const redemptionDetail = item.redemptionType === "storeTaskReward"
                  ? `${item.storeName || "门店"} · ${item.productKey || ""} · ${item.periodKey || ""} · 商品价值 ¥${item.rewardValue || 0}（门店额度，不扣金豆）`
                  : `${item.goldenBeanCost} 金豆`;
                return (
                  <div className="ledger-row redemption-row" key={item.id}>
                    <div>
                      <strong>{getEmployeeName(employees, item.employeeId)}</strong>
                      <p>{rewardTitle} · {redemptionDetail} · {item.createdAt}</p>
                    </div>
                    <div className="redemption-actions">
                      <Badge>{statusLabel[item.status]}</Badge>
                      {item.status === "pending" ? (
                        <button
                          disabled={fulfillingRedemptionId === item.id}
                          onClick={() => handleFulfillRedemption(item)}
                          type="button"
                        >
                          {fulfillingRedemptionId === item.id ? "发放中" : "确认发放"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </section>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string | number; detail: string }) {
  return (
    <article className="stat-card">
      <div className="stat-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function Panel({
  id,
  title,
  action,
  onAction,
  children
}: {
  id?: string;
  title: string;
  action: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="panel" id={id}>
      <div className="panel-header">
        <h2>{title}</h2>
        <button onClick={onAction}>{action}</button>
      </div>
      {children}
    </section>
  );
}

function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="section-header">
      <div className="section-icon">{icon}</div>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function CourseManagementPanel({
  courses,
  courseForm,
  isSaving,
  uploadingAsset,
  onChange,
  onEdit,
  onDelete,
  onReset,
  onSave,
  onAssetUpload
}: {
  courses: CourseRecord[];
  courseForm: CourseFormState;
  isSaving: boolean;
  uploadingAsset: "productImage" | "coverImage" | "videoUrl" | "resourceFile" | null;
  onChange: (field: keyof CourseFormState, value: string) => void;
  onEdit: (course: CourseRecord) => void;
  onDelete: (course: CourseRecord) => void;
  onReset: () => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
  onAssetUpload: (field: "productImage" | "coverImage" | "videoUrl" | "resourceFile", fileList: FileList | null) => void;
}) {
  return (
    <section className="resource-panel course-manager" id="courses">
      <SectionHeader icon={<BookOpen size={18} />} title="课程管理" subtitle="上传图文、PDF、PPT、文档和资料链接" />

      <form className="course-form" onSubmit={onSave}>
        <div className="form-row compact">
          <label>
            <span>课程类型</span>
            <select value={courseForm.track} onChange={(event) => onChange("track", event.target.value)}>
              <option value="product">产品学习点</option>
              <option value="chronic">慢病学习</option>
            </select>
          </label>
          <label>
            <span>发布状态</span>
            <select value={courseForm.status} onChange={(event) => onChange("status", event.target.value)}>
              <option value="published">已发布</option>
              <option value="draft">草稿</option>
            </select>
          </label>
        </div>

        <label>
            <span>资料标题</span>
          <input
            value={courseForm.title}
            onChange={(event) => onChange("title", event.target.value)}
            placeholder="例如：糖尿病顾客基础沟通"
          />
        </label>

        <div className="form-row">
          <label>
            <span>{courseForm.track === "product" ? "产品名称" : "慢病分类"}</span>
            {courseForm.track === "product" ? (
              <input
                value={courseForm.productName}
                onChange={(event) => onChange("productName", event.target.value)}
                placeholder="例如：抗炎先锋"
              />
            ) : (
              <select
                value={courseForm.chronicCategory}
                onChange={(event) => onChange("chronicCategory", event.target.value)}
              >
                <option value="diabetes">糖尿病</option>
                <option value="hypertension">高血压</option>
                <option value="hyperuricemia">高尿酸</option>
                <option value="hyperlipidemia">高血脂</option>
              </select>
            )}
          </label>
          <label>
            <span>时长</span>
            <input
              value={courseForm.duration}
              onChange={(event) => onChange("duration", event.target.value)}
              placeholder="10 分钟"
            />
          </label>
        </div>

        <textarea
          value={courseForm.description}
          onChange={(event) => onChange("description", event.target.value)}
          placeholder="资料简介，会显示在 H5 学习列表中"
          rows={3}
        />

        <div className="form-row compact">
          <label>
            <span>金豆</span>
            <input
              value={courseForm.goldenBeans}
              onChange={(event) => onChange("goldenBeans", event.target.value)}
              inputMode="numeric"
              min="0"
              step="1"
              type="number"
            />
          </label>
          <label>
            <span>排序</span>
            <input
              value={courseForm.sortOrder}
              onChange={(event) => onChange("sortOrder", event.target.value)}
              inputMode="numeric"
            />
          </label>
        </div>

        <AssetInput
          icon={<ImageIcon size={15} />}
          label="产品图片"
          value={courseForm.productImage}
          disabled={courseForm.track !== "product"}
          isUploading={uploadingAsset === "productImage"}
          onChange={(value) => onChange("productImage", value)}
          onUpload={(files) => onAssetUpload("productImage", files)}
        />
        <AssetInput
          icon={<ImageIcon size={15} />}
          label="视频封面"
          value={courseForm.coverImage}
          isUploading={uploadingAsset === "coverImage"}
          onChange={(value) => onChange("coverImage", value)}
          onUpload={(files) => onAssetUpload("coverImage", files)}
        />
        <AssetInput
          icon={<Film size={15} />}
          label="课程视频"
          value={courseForm.videoUrl}
          accept="video/*,.mp4,.mov,.m4v,.webm"
          isUploading={uploadingAsset === "videoUrl"}
          onChange={(value) => onChange("videoUrl", value)}
          onUpload={(files) => onAssetUpload("videoUrl", files)}
        />
        <div className="form-row compact">
          <label>
            <span>学习资料形式</span>
            <select value={courseForm.resourceType} onChange={(event) => onChange("resourceType", event.target.value)}>
              <option value="">上传文件后自动识别</option>
              <option value="pdf">PDF 文件</option>
              <option value="ppt">PPT 文件</option>
              <option value="doc">Word 文档</option>
              <option value="video-link">视频链接</option>
            </select>
          </label>
          <label>
            <span>资料文件名</span>
            <input
              readOnly
              value={courseForm.resourceName}
              onChange={(event) => onChange("resourceName", event.target.value)}
              placeholder="选择文件后自动填写"
            />
          </label>
        </div>
        {courseForm.resourceType === "video-link" ? (
          <AssetInput
            icon={<Film size={15} />}
            label="视频链接（后台保存）"
            value={courseForm.resourceUrl}
            onChange={(value) => onChange("resourceUrl", value)}
            isUploading={false}
            onUpload={() => undefined}
          />
        ) : (
          <AssetInput
            icon={<FileText size={15} />}
            label={courseForm.resourceType === "ppt" ? "上传 PPT 文件（自动识别页数）" : "上传学习资料（可直接选择 PPT）"}
            value={courseForm.resourceUrl}
            accept=".pdf,.ppt,.pptx,.doc,.docx,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            isUploading={uploadingAsset === "resourceFile"}
            onChange={(value) => onChange("resourceUrl", value)}
            onUpload={(files) => onAssetUpload("resourceFile", files)}
          />
        )}

        {courseForm.resourceType === "ppt" ? (
          <div className={`ppt-processing-status is-${courseForm.pptProcessingStatus || "waiting"}`} role="status">
            <FileText size={18} />
            <div>
              <strong>{courseForm.pptProcessingStatus === "processing"
                ? "正在自动处理 PPT"
                : courseForm.pptProcessingStatus === "ready"
                  ? `PPT 已就绪，共 ${courseForm.slideCount} 页`
                  : courseForm.pptProcessingStatus === "failed"
                    ? "PPT 自动处理失败"
                    : "上传 PPT 后自动识别页数"}</strong>
              <span>{courseForm.pptProcessingStatus === "processing"
                ? "正在生成员工端页面，请保持当前页面打开。"
                : courseForm.pptProcessingStatus === "failed"
                  ? "文件已上传，但腾讯云还没有完成页面转换。请先在当前存储桶开通数据万象文档处理并配置云函数权限，再点击上传重试。"
                  : "每页学习时间固定为 3 秒，不需要填写页数或路径。"}</span>
            </div>
          </div>
        ) : null}

        <div className="course-form-actions">
          <button disabled={isSaving} type="submit">
            <Save size={15} />{isSaving ? "保存中" : courseForm.courseId ? "保存修改" : "新增课程"}
          </button>
          <button className="ghost" onClick={onReset} type="button">
            <Plus size={15} />新建空白
          </button>
        </div>
      </form>

      <div className="resource-list course-list">
        {courses.map((course) => (
          <article className="resource-row course-row" key={course.id}>
            <div>
              <strong>{course.title}</strong>
              <p>{courseTrackLabel[course.track === "chronic" ? "chronic" : "product"]} · {getCourseTypeText(course)} · {getResourceTypeText(course)} · {course.duration} · {course.goldenBeans} 金豆</p>
            </div>
            <Badge>{statusLabel[course.status]}</Badge>
            <div className="row-actions">
              <button className="row-action" onClick={() => onEdit(course)} type="button">
                <Pencil size={14} />编辑
              </button>
              <button aria-label={`删除${course.title}`} className="row-action danger" onClick={() => onDelete(course)} title="删除课程" type="button">
                <Trash2 size={14} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PhraseManagementPanel({
  phrases,
  form,
  isSaving,
  onChange,
  onEdit,
  onDelete,
  onReset,
  onSave,
  uploadingAudio,
  onAudioUpload
}: {
  phrases: PhraseRecord[];
  form: PhraseFormState;
  isSaving: boolean;
  onChange: (field: keyof PhraseFormState, value: string) => void;
  onEdit: (phrase: PhraseRecord) => void;
  onDelete: (phrase: PhraseRecord) => void;
  onReset: () => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
  uploadingAudio: boolean;
  onAudioUpload: (fileList: FileList | null) => void;
}) {
  return (
    <section className="resource-panel phrase-manager" id="phrases">
      <SectionHeader icon={<Mic size={18} />} title="金句开口说" subtitle="配置标准话术、每次奖励和计分次数" />
      <form className="course-form" onSubmit={onSave}>
        <div className="form-row compact">
          <label>
            <span>产品名称</span>
            <input value={form.productName} onChange={(event) => onChange("productName", event.target.value)} />
          </label>
          <label>
            <span>发布状态</span>
            <select value={form.status} onChange={(event) => onChange("status", event.target.value)}>
              <option value="published">已发布</option>
              <option value="draft">草稿</option>
            </select>
          </label>
        </div>
        <label>
          <span>金句标题</span>
          <input value={form.title} onChange={(event) => onChange("title", event.target.value)} placeholder="例如：产品定位" />
        </label>
        <label>
          <span>标准话术</span>
          <textarea value={form.script} onChange={(event) => onChange("script", event.target.value)} rows={4} />
        </label>
        <AssetInput
          icon={<Volume2 size={15} />}
          label="标准示范录音"
          value={form.audioUrl}
          accept="audio/*,.mp3,.m4a,.wav,.aac"
          isUploading={uploadingAudio}
          onChange={(value) => onChange("audioUrl", value)}
          onUpload={onAudioUpload}
        />
        {form.audioName ? <p className="asset-file-name"><Volume2 size={14} />{form.audioName}</p> : null}
        <div className="form-row compact">
          <label>
            <span>每次奖励</span>
            <input min="0" step="1" type="number" value={form.goldenBeans} onChange={(event) => onChange("goldenBeans", event.target.value)} />
          </label>
          <label>
            <span>最多计分次数</span>
            <input min="1" step="1" type="number" value={form.maxRewardedAttempts} onChange={(event) => onChange("maxRewardedAttempts", event.target.value)} />
          </label>
          <label>
            <span>排序</span>
            <input min="0" step="1" type="number" value={form.sortOrder} onChange={(event) => onChange("sortOrder", event.target.value)} />
          </label>
        </div>
        <div className="course-form-actions">
          <button disabled={isSaving} type="submit"><Save size={15} />{isSaving ? "保存中" : form.phraseId ? "保存金句" : "新增金句"}</button>
          <button className="ghost" onClick={onReset} type="button"><Plus size={15} />新建空白</button>
        </div>
      </form>
      <div className="resource-list course-list">
        {phrases.map((phrase) => (
          <article className="resource-row course-row" key={phrase.id}>
            <div>
              <strong>{phrase.title}</strong>
              <p>{phrase.productName || "未设置产品"} · {phrase.goldenBeans} 金豆/次 · 最多 {phrase.maxRewardedAttempts ?? 1} 次</p>
            </div>
            <Badge>{statusLabel[phrase.status]}</Badge>
            <div className="row-actions">
              <button className="row-action" onClick={() => onEdit(phrase)} type="button"><Pencil size={14} />编辑</button>
              <button aria-label={`删除${phrase.title}`} className="row-action danger" onClick={() => onDelete(phrase)} title="删除金句" type="button"><Trash2 size={14} /></button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CaseImageInput({
  values,
  isUploading,
  onUpload,
  onRemove
}: {
  values: string[];
  isUploading: boolean;
  onUpload: (fileList: FileList | null) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="asset-input case-image-input">
      <span><ImageIcon size={15} />案例图片（可多选，最多 9 张）</span>
      {values.length ? <div className="case-image-selection">{values.map((value, index) => (
        <div key={`${value}-${index}`}>
          {/^(cloud|cloudbase):\/\//i.test(value)
            ? <span className="case-image-uploaded"><ImageIcon size={22} />第 {index + 1} 张已上传</span>
            : <img src={value} alt={`待发布案例图片 ${index + 1}`} />}
          <button type="button" aria-label={`删除第 ${index + 1} 张案例图片`} title="删除图片" onClick={() => onRemove(index)}><Trash2 size={15} /></button>
        </div>
      ))}</div> : null}
      <label className={`upload-button ${isUploading || values.length >= 9 ? "disabled" : ""}`}>
        <Upload size={14} />
        {isUploading ? "上传中" : values.length ? `继续添加（${values.length}/9）` : "选择多张图片"}
        <input
          accept="image/*"
          disabled={isUploading || values.length >= 9}
          multiple
          onChange={(event) => {
            onUpload(event.target.files);
            event.target.value = "";
          }}
          type="file"
        />
      </label>
    </div>
  );
}

function AssetInput({
  icon,
  label,
  value,
  accept = "image/*",
  disabled = false,
  isUploading,
  onChange,
  onUpload
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accept?: string;
  disabled?: boolean;
  isUploading: boolean;
  onChange: (value: string) => void;
  onUpload: (fileList: FileList | null) => void;
}) {
  return (
    <div className={`asset-input ${disabled ? "disabled" : ""}`}>
      <span>{icon}{label}</span>
      <div>
        <input
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={disabled ? "产品课程才需要产品图片" : "可粘贴图片/视频链接，也可上传文件"}
        />
        <label className={`upload-button ${disabled ? "disabled" : ""}`}>
          <Upload size={14} />
          {isUploading ? "上传中" : "上传"}
          <input
            accept={accept}
            disabled={disabled || isUploading}
            onChange={(event) => {
              onUpload(event.target.files);
              event.target.value = "";
            }}
            type="file"
          />
        </label>
      </div>
    </div>
  );
}

function GoldenBeanAdjustPanel({
  employees,
  form,
  isSaving,
  onChange,
  onSave
}: {
  employees: EmployeeRecord[];
  form: GoldenBeanAdjustFormState;
  isSaving: boolean;
  onChange: (field: keyof GoldenBeanAdjustFormState, value: string) => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const selectedEmployee = employees.find((employee) => employee.id === form.employeeId);

  return (
    <form className="course-form golden-adjust-form" onSubmit={onSave}>
      <div className="form-row compact">
        <label>
          <span>员工</span>
          <select value={form.employeeId} onChange={(event) => onChange("employeeId", event.target.value)}>
            <option value="">请选择员工</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name} · {employee.employeeNo} · {employee.goldenBeans} 金豆
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>调整数量</span>
          <input
            value={form.delta}
            onChange={(event) => onChange("delta", event.target.value)}
            placeholder="增加填 100，扣减填 -100"
            inputMode="numeric"
          />
        </label>
      </div>
      <label>
        <span>调整原因</span>
        <input
          value={form.reason}
          onChange={(event) => onChange("reason", event.target.value)}
          placeholder="例如：线下学习奖励 / 活动补发 / 误发扣回"
        />
      </label>
      <div className="golden-adjust-footer">
        <p>
          当前员工余额：
          <strong>{selectedEmployee ? `${selectedEmployee.goldenBeans} 金豆` : "未选择"}</strong>
        </p>
        <button disabled={isSaving} type="submit">
          <Save size={15} />{isSaving ? "调整中" : "确认调整"}
        </button>
      </div>
    </form>
  );
}

function TaskRewardsPanel({
  form,
  isSaving,
  onChange,
  onSave
}: {
  form: TaskRewardsFormState;
  isSaving: boolean;
  onChange: (field: keyof TaskRewardsFormState, value: string) => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="course-form task-rewards-form" onSubmit={onSave}>
      <div className="form-row compact">
        <label>
          <span>POP 上传</span>
          <input
            value={form.pop}
            onChange={(event) => onChange("pop", event.target.value)}
            inputMode="numeric"
            min="0"
            step="1"
            type="number"
          />
        </label>
        <label>
          <span>金句开口说</span>
          <input
            value={form.phrase}
            onChange={(event) => onChange("phrase", event.target.value)}
            inputMode="numeric"
            min="0"
            step="1"
            type="number"
          />
        </label>
        <label>
          <span>案例分享</span>
          <input
            value={form.case}
            onChange={(event) => onChange("case", event.target.value)}
            inputMode="numeric"
            min="0"
            step="1"
            type="number"
          />
        </label>
      </div>
      <div className="golden-adjust-footer">
        <p>提交类任务可设为 0；视频、试卷和金句分值在各自内容中配置。</p>
        <button disabled={isSaving} type="submit">
          <Save size={15} />{isSaving ? "保存中" : "保存任务金豆"}
        </button>
      </div>
    </form>
  );
}

function ProductRewardRulePanel({
  form,
  isSaving,
  onChange,
  onSave
}: {
  form: ProductRewardRuleFormState;
  isSaving: boolean;
  onChange: (field: keyof ProductRewardRuleFormState, value: string) => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="course-form product-reward-rule-form" onSubmit={onSave}>
      <div className="form-row compact">
        <label>
          <span>产品名称</span>
          <input value={form.productName} onChange={(event) => onChange("productName", event.target.value)} />
        </label>
        <label>
          <span>计分产品键</span>
          <input value={form.productKey} onChange={(event) => onChange("productKey", event.target.value)} />
        </label>
      </div>
      <div className="form-row compact">
        <label>
          <span>个人累计上限</span>
          <input
            min="0"
            step="1"
            type="number"
            value={form.rewardCap}
            onChange={(event) => onChange("rewardCap", event.target.value)}
          />
        </label>
        <label>
          <span>状态</span>
          <select value={form.status} onChange={(event) => onChange("status", event.target.value)}>
            <option value="active">启用</option>
            <option value="inactive">停用</option>
          </select>
        </label>
      </div>
      <div className="golden-adjust-footer">
        <p>达到产品累计上限后仍可学习，但不再发放金豆。</p>
        <button disabled={isSaving} type="submit"><Save size={15} />{isSaving ? "保存中" : "保存产品上限"}</button>
      </div>
    </form>
  );
}

function StoreManagementPanel({
  storeForm,
  stores,
  brands,
  isSaving,
  onChange,
  onEdit,
  onReset,
  onSave
}: {
  storeForm: StoreFormState;
  stores: StoreRecord[];
  brands: Brand[];
  isSaving: boolean;
  onChange: (field: keyof StoreFormState, value: string) => void;
  onEdit: (store: StoreRecord) => void;
  onReset: () => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const groupedStores = new Map<string, { name: string; stores: StoreRecord[] }>();
  for (const store of stores) {
    const brandId = store.brandId || "";
    const group = groupedStores.get(brandId) || {
      name: brands.find((brand) => brand.id === brandId)?.name || store.brandName || "未分组",
      stores: []
    };
    group.stores.push(store);
    groupedStores.set(brandId, group);
  }

  return (
    <section className="resource-panel people-panel" id="store-management">
      <SectionHeader icon={<Store size={18} />} title="组织管理" subtitle="H5 登录只能选择这里的门店或部门" />
      <form className="course-form" onSubmit={onSave}>
        <label>
          <span>组织名称</span>
          <input
            value={storeForm.name}
            onChange={(event) => onChange("name", event.target.value)}
            placeholder="例如：示例门店"
          />
        </label>
        <div className="form-row compact">
          <label><span>品牌</span><select value={storeForm.brandId || brands.find((brand) => brand.status !== "inactive")?.id || ""} onChange={(event) => onChange("brandId", event.target.value)}>
            {!brands.length && <option value="">暂无品牌</option>}
            {brands.filter((brand) => brand.status !== "inactive" || brand.id === storeForm.brandId).map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
          </select></label>
          <label><span>组织类型</span><select value={storeForm.organizationType} onChange={(event) => onChange("organizationType", event.target.value)}><option value="store">门店</option><option value="department">部门</option></select></label>
        </div>
        <div className="form-row compact">
          <label><span>店号</span><input value={storeForm.storeNo} onChange={(event) => onChange("storeNo", event.target.value)} placeholder="可留空" /></label>
          <label><span>状态</span><select value={storeForm.status} onChange={(event) => onChange("status", event.target.value)}><option value="active">启用</option><option value="inactive">停用</option></select></label>
        </div>
        <label><span>地址</span><input value={storeForm.address} onChange={(event) => onChange("address", event.target.value)} /></label>
        <label><span>区域 ID</span><input value={storeForm.regionId} onChange={(event) => onChange("regionId", event.target.value)} /></label>
        <div className="course-form-actions">
          <button disabled={isSaving} type="submit">
            <Save size={15} />{isSaving ? "保存中" : storeForm.storeId ? "保存门店" : "新增门店"}
          </button>
          <button className="ghost" onClick={onReset} type="button">
            <Plus size={15} />新建空白
          </button>
        </div>
      </form>
      <div className="organization-admin-groups">
        {[...groupedStores].map(([brandId, group]) => <section key={brandId}><h3>{group.name} · {group.stores.length}</h3><div className="resource-list compact-list">
          {group.stores.map((store) => (
            <article className="resource-row course-row" key={store.id}>
              <div><strong>{store.name}</strong><p>{store.storeNo ? `${store.storeNo} 号 · ` : ""}{store.organizationType === "department" ? "部门" : "门店"} · {store.status === "inactive" ? "停用" : "启用"}</p></div>
              <button className="row-action" onClick={() => onEdit(store)} type="button"><Pencil size={14} />编辑</button>
            </article>
          ))}
        </div></section>)}
      </div>
    </section>
  );
}

function EmployeeManagementPanel({
  employeeForm,
  employees,
  stores,
  products,
  isSaving,
  importPreview,
  isImporting,
  onChange,
  onCancelImport,
  onConfirmImport,
  onDownloadTemplate,
  onEdit,
  onImportFile,
  onReset,
  onSave
}: {
  employeeForm: EmployeeFormState;
  employees: EmployeeRecord[];
  stores: StoreRecord[];
  products: string[];
  isSaving: boolean;
  importPreview: EmployeeImportPreviewState | null;
  isImporting: boolean;
  onChange: (field: keyof EmployeeFormState, value: string) => void;
  onCancelImport: () => void;
  onConfirmImport: () => void;
  onDownloadTemplate: () => void;
  onEdit: (employee: EmployeeRecord) => void;
  onImportFile: (fileList: FileList | null) => void;
  onReset: () => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const selectedSupplierProducts = new Set(supplierProductKeys(employeeForm.supplierProductKeys));

  return (
    <section className="resource-panel people-panel" id="employee-management">
      <SectionHeader icon={<Users size={18} />} title="员工名单管理" subtitle="单个维护或批量导入员工姓名、门店与职位" />
      <div className="employee-import-toolbar">
        <label className={`upload-button ${isImporting ? "disabled" : ""}`}>
          <FileUp size={14} />{isImporting ? "读取中" : "导入员工名单"}
          <input
            accept=".xlsx,.csv"
            disabled={isImporting}
            onChange={(event) => {
              onImportFile(event.target.files);
              event.currentTarget.value = "";
            }}
            type="file"
          />
        </label>
        <button className="ghost" onClick={onDownloadTemplate} type="button"><Download size={14} />下载模板</button>
      </div>
      {importPreview ? (
        <div className="employee-import-preview">
          <div className="employee-import-summary">
            <div><span>文件</span><strong>{importPreview.fileName}</strong></div>
            <div><span>总行数</span><strong>{importPreview.result.summary.total}</strong></div>
            <div><span>新增</span><strong>{importPreview.result.summary.created}</strong></div>
            <div><span>更新</span><strong>{importPreview.result.summary.updated}</strong></div>
            <div><span>错误</span><strong className={importPreview.result.errors.length ? "import-error-count" : ""}>{importPreview.result.errors.length}</strong></div>
          </div>
          {importPreview.result.errors.length > 0 ? (
            <div className="employee-import-errors">
              {importPreview.result.errors.slice(0, 8).map((error) => (
                <p key={`${error.rowNumber}-${error.message}`}>第 {error.rowNumber} 行{error.name ? `（${error.name}）` : ""}：{error.message}</p>
              ))}
            </div>
          ) : (
            <p className="employee-import-ready">预检通过。点击确认后才会写入员工名单。</p>
          )}
          <div className="course-form-actions">
            <button disabled={isImporting || importPreview.result.errors.length > 0} onClick={onConfirmImport} type="button">
              <Upload size={14} />{isImporting ? "导入中" : "确认导入"}
            </button>
            <button className="ghost" disabled={isImporting} onClick={onCancelImport} type="button">取消</button>
          </div>
        </div>
      ) : null}
      <form className="course-form" onSubmit={onSave}>
        <div className="form-row compact">
          <label>
            <span>姓名</span>
            <input
              value={employeeForm.name}
              onChange={(event) => onChange("name", event.target.value)}
              placeholder="例如：林可"
            />
          </label>
          <label>
            <span>员工编号</span>
            <input
              value={employeeForm.employeeNo}
              onChange={(event) => onChange("employeeNo", event.target.value)}
              placeholder="例如：GZ1001"
            />
          </label>
        </div>
        <div className="form-row compact">
          <label>
            <span>所属门店</span>
            {employeeForm.role === "supplier" ? (
              <input aria-label="供应商所属组织" readOnly value="供应商" />
            ) : (
              <select value={employeeForm.storeId} onChange={(event) => onChange("storeId", event.target.value)}>
                <option value="">请选择门店</option>
                {stores.filter((store) => store.name !== "供应商").map((store) => (
                  <option key={store.id} value={store.id}>{store.name}</option>
                ))}
              </select>
            )}
          </label>
          <label>
            <span>职位</span>
            <input readOnly={employeeForm.role === "supplier"} value={employeeForm.position} onChange={(event) => onChange("position", event.target.value)} placeholder="例如：店员、运营总监" />
          </label>
        </div>
        <div className="form-row compact">
          <label>
            <span>角色</span>
            <select value={employeeForm.role} onChange={(event) => onChange("role", event.target.value)}>
                <option value="employee">员工</option>
                <option value="storeManager">店长</option>
                <option value="admin">管理员</option>
                <option value="supplier">供应商</option>
            </select>
          </label>
          <label>
            <span>状态</span>
            <select value={employeeForm.status} onChange={(event) => onChange("status", event.target.value)}>
              <option value="active">启用</option>
              <option value="inactive">停用</option>
            </select>
          </label>
        </div>
        {employeeForm.role === "supplier" ? (
          <div className="form-row compact">
            <label>
              <span>供应商/厂家</span>
              <input value={employeeForm.supplierName} onChange={(event) => onChange("supplierName", event.target.value)} placeholder="例如：示例供应商" />
            </label>
            <div className="supplier-product-field">
              <span className="supplier-product-label">授权产品（可多选）</span>
              {products.length ? <div className="supplier-product-picker" role="group" aria-label="供应商授权产品">
                {products.map((product) => {
                  const checked = selectedSupplierProducts.has(product);
                  return <label className={`supplier-product-option${checked ? " is-selected" : ""}`} key={product}>
                    <input
                      checked={checked}
                      onChange={(event) => onChange("supplierProductKeys", toggleSupplierProduct(employeeForm.supplierProductKeys, product, event.target.checked))}
                      type="checkbox"
                    />
                    <span>{product}</span>
                  </label>;
                })}
              </div> : <p className="supplier-product-empty">当前还没有可授权产品，请先配置课程、开口说、考试或产品任务。</p>}
              <small className="supplier-product-hint">已勾选 {selectedSupplierProducts.size} 个产品{selectedSupplierProducts.size ? `：${Array.from(selectedSupplierProducts).join("、")}` : ""}。保存后供应商只可查看这些产品。</small>
            </div>
          </div>
        ) : null}
        <div className="form-row metrics">
          <label>
            <span>初始金豆</span>
            <input
              value={employeeForm.goldenBeans}
              onChange={(event) => onChange("goldenBeans", event.target.value)}
              inputMode="numeric"
            />
          </label>
          <label>
            <span>课程完成率</span>
            <input
              value={employeeForm.courseCompletionRate}
              onChange={(event) => onChange("courseCompletionRate", event.target.value)}
              inputMode="numeric"
            />
          </label>
          <label>
            <span>考试通过率</span>
            <input
              value={employeeForm.examPassRate}
              onChange={(event) => onChange("examPassRate", event.target.value)}
              inputMode="numeric"
            />
          </label>
        </div>
        <div className="course-form-actions">
          <button disabled={isSaving} type="submit">
            <Save size={15} />{isSaving ? "保存中" : employeeForm.employeeId ? "保存员工" : "新增员工"}
          </button>
          <button className="ghost" onClick={onReset} type="button">
            <Plus size={15} />新建空白
          </button>
        </div>
      </form>
      <div className="resource-list compact-list">
        {employees.slice(0, 8).map((employee) => (
          <article className="resource-row course-row" key={employee.id}>
            <div>
              <strong>{employee.name}{employee.role === "supplier" ? <span className="bean-pill">供应商</span> : null}</strong>
              <p>{employee.role === "supplier" ? `供应商｜${employee.supplierName || "未填写厂家"}` : employee.position || "未填写职位"} · {employee.employeeNo} · {getStoreName(stores, employee.storeId)}</p>
            </div>
            <button className="row-action" onClick={() => onEdit(employee)} type="button">
              <Pencil size={14} />编辑
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function currentTaskPeriod() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function taskStatusText(status: "completed" | "learning-required" | "exam-required") {
  return status === "completed" ? "任务已完成" : status === "learning-required" ? "需学习" : "需考试";
}

function ProductTaskProgressPanel({
  employees,
  stores,
  courses,
  phrases,
  exams,
  employeeProductTasks,
  storeProductSales,
  courseProgress,
  examAttempts,
  phrasePracticeAttempts,
  isImporting,
  isImportingStoreProductSales,
  isSettingUniformStoreTarget,
  isApplyingNinetyPointRule,
  onDownloadTemplate,
  onImportFile,
  onDownloadStoreSalesTemplate,
  onImportStoreSalesFile,
  onClearStoreSales,
  onUniformTask,
  onUniformStoreTask,
  onClearUniformTask,
  onEnforceNinetyPointRule
}: {
  employees: AdminData["employees"];
  stores: AdminData["stores"];
  courses: AdminData["courses"];
  phrases: AdminData["phrases"];
  exams: AdminData["exams"];
  employeeProductTasks: AdminData["employeeProductTasks"];
  storeProductSales: AdminData["storeProductSales"];
  courseProgress: AdminData["courseProgress"];
  examAttempts: AdminData["examAttempts"];
  phrasePracticeAttempts: AdminData["phrasePracticeAttempts"];
  isImporting: boolean;
  isImportingStoreProductSales: boolean;
  isSettingUniformStoreTarget: boolean;
  isApplyingNinetyPointRule: boolean;
  onDownloadTemplate: () => void;
  onImportFile: (files: FileList | null) => void;
  onDownloadStoreSalesTemplate: () => void;
  onImportStoreSalesFile: (files: FileList | null) => void;
  onClearStoreSales: (input: { productKey: string; periodKey: string }) => void;
  onUniformTask: (input: { productKey: string; periodKey: string; targetQuantity: number }) => void;
  onUniformStoreTask: (input: { productKey: string; periodKey: string; targetQuantity: number }) => void;
  onClearUniformTask: (input: { productKey: string; periodKey: string }) => void;
  onEnforceNinetyPointRule: () => void;
}) {
  const productOptions = [...new Set([
    ...employeeProductTasks.map((item) => item.productKey),
    ...courses.filter((item) => (item.track || "product") === "product").map((item) => item.productName || ""),
    ...phrases.map((item) => item.productName || ""),
    ...exams.map((item) => item.productName || ""),
    ...storeProductSales.map((item) => item.productKey || "")
  ].map((item) => String(item).trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-CN"));
  const periods = [...new Set([currentTaskPeriod(), ...employeeProductTasks.map((item) => item.periodKey).filter(Boolean), ...storeProductSales.map((item) => item.periodKey).filter(Boolean)])]
    .sort((left, right) => right.localeCompare(left));
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState(currentTaskPeriod());
  const productKey = selectedProduct || productOptions[0] || "";
  const [uniformTarget, setUniformTarget] = useState("3");
  const [uniformStoreTarget, setUniformStoreTarget] = useState("10");

  const rows = employees.filter((employee) => employee.status === "active").map((employee) => {
    const task = employeeProductTasks.find((item) => (
      sameAdminId(item.employeeId, employee.id) && item.productKey === productKey && item.periodKey === selectedPeriod
    ));
    const target = Number(task?.targetQuantity || 0);
    const completedQuantity = Number(task?.completedQuantity || 0);
    const status: "completed" | "learning-required" | "exam-required" = task
      ? (target > 0 && completedQuantity >= target ? "completed" : "learning-required")
      : "exam-required";
    const productCourses = courses.filter((course) => (
      course.status === "published" && (course.track || "product") === "product" && course.productName === productKey
    ));
    const productPhrases = phrases.filter((phrase) => (
      phrase.status === "published" && phrase.productName === productKey
    ));
    const productExams = exams.filter((exam) => (
      exam.status === "published" && exam.productName === productKey
    ));
    const completedCourses = productCourses.filter((course) => courseProgress.some((progress) => (
      sameAdminId(progress.employeeId, employee.id)
      && sameAdminId(progress.courseId, course.id)
      && adminProgressCompleted(progress)
    )));
    const completedPhrases = productPhrases.filter((phrase) => phrasePracticeAttempts.some((attempt) => (
      sameAdminId(attempt.employeeId, employee.id)
      && sameAdminId(attempt.phraseId, phrase.id)
      && attempt.passed !== false
    )));
    const highestExamScore = productExams.reduce((highest, exam) => Math.max(highest, ...examAttempts
      .filter((attempt) => sameAdminId(attempt.employeeId, employee.id) && sameAdminId(attempt.examId, exam.id))
      .map((attempt) => Number(attempt.score || 0))), 0);
    const learningReady = productCourses.length > 0 && completedCourses.length === productCourses.length;
    const phrasesReady = productPhrases.length > 0 && completedPhrases.length === productPhrases.length;
    return {
      employee,
      task,
      target,
      completedQuantity,
      status,
      productCourses,
      completedCourses,
      productPhrases,
      completedPhrases,
      highestExamScore,
      learningReady,
      phrasesReady
    };
  });
  const completedTaskCount = rows.filter((row) => row.status === "completed").length;
  const learningCompleteCount = rows.filter((row) => row.status === "learning-required" && row.learningReady).length;
  const learningOutstandingCount = rows.filter((row) => row.status === "learning-required" && !row.learningReady).length;
  const selectedStoreSales = storeProductSales
    .filter((sale) => sale.productKey === productKey && sale.periodKey === selectedPeriod)
    .sort((left, right) => (
      Number(right.attainmentRate ?? (right.targetQuantity ? right.completedQuantity / right.targetQuantity * 100 : 0))
      - Number(left.attainmentRate ?? (left.targetQuantity ? left.completedQuantity / left.targetQuantity * 100 : 0))
      || Number(right.completedQuantity || 0) - Number(left.completedQuantity || 0)
      || getStoreName(stores, left.storeId).localeCompare(getStoreName(stores, right.storeId), "zh-CN")
    ));

  return (
    <section className="table-section product-task-section" id="product-tasks">
      <SectionHeader
        icon={<FileSpreadsheet size={19} />}
        title="产品任务与学习进度"
        subtitle="仅总部后台使用。按产品任务查看谁已完成、谁需要继续学习、开口说或考试。"
      />
      <div className="product-task-toolbar">
        <label>
          <span>产品</span>
          <select value={productKey} onChange={(event) => setSelectedProduct(event.target.value)}>
            {productOptions.length ? productOptions.map((item) => <option key={item} value={item}>{item}</option>) : <option value="">暂无已配置产品</option>}
          </select>
        </label>
        <label>
          <span>统计周期</span>
          <select value={selectedPeriod} onChange={(event) => setSelectedPeriod(event.target.value)}>
            {periods.map((period) => <option key={period} value={period}>{period}</option>)}
          </select>
        </label>
        <label className={`upload-button ${isImporting ? "disabled" : ""}`}>
          <FileUp size={14} />{isImporting ? "导入中" : "导入产品任务"}
          <input
            accept=".xlsx,.csv"
            disabled={isImporting}
            onChange={(event) => {
              onImportFile(event.target.files);
              event.currentTarget.value = "";
            }}
            type="file"
          />
        </label>
        <button className="ghost" onClick={onDownloadTemplate} type="button"><Download size={14} />下载模板</button>
        <label className="uniform-task-control">
          <span>统一任务</span>
          <input inputMode="numeric" min="1" step="1" value={uniformTarget} onChange={(event) => setUniformTarget(event.target.value)} aria-label="统一任务数量" />
          <em>盒</em>
        </label>
        <button className="secondary" disabled={!productKey || !selectedPeriod || !/^[1-9]\d*$/.test(uniformTarget)} onClick={() => onUniformTask({ productKey, periodKey: selectedPeriod, targetQuantity: Number(uniformTarget) })} type="button"><Save size={14} />一键设置任务</button>
        <label className="uniform-task-control store-uniform-task-control">
          <span>门店销售目标</span>
          <input inputMode="numeric" min="1" step="1" value={uniformStoreTarget} onChange={(event) => setUniformStoreTarget(event.target.value)} aria-label="统一门店销售目标" />
          <em>盒</em>
        </label>
        <button className="secondary" disabled={isSettingUniformStoreTarget || !productKey || !selectedPeriod || !/^[1-9]\d*$/.test(uniformStoreTarget)} onClick={() => onUniformStoreTask({ productKey, periodKey: selectedPeriod, targetQuantity: Number(uniformStoreTarget) })} type="button"><Store size={14} />{isSettingUniformStoreTarget ? "设置中" : "统一设置门店目标"}</button>
        <button className="danger" disabled={!productKey || !selectedPeriod} onClick={() => onClearUniformTask({ productKey, periodKey: selectedPeriod })} type="button"><Trash2 size={14} />撤回/清零任务</button>
        <button className="secondary" disabled={isApplyingNinetyPointRule} onClick={onEnforceNinetyPointRule} type="button">
          <ClipboardCheck size={14} />{isApplyingNinetyPointRule ? "更新中" : "统一考试及格线 90 分"}
        </button>
      </div>
      <div className="product-task-summary">
        <div><span>在职员工</span><strong>{rows.length}</strong></div>
        <div><span>任务已完成</span><strong>{completedTaskCount}</strong></div>
        <div><span>资料学习完成</span><strong>{learningCompleteCount}</strong></div>
        <div><span>资料学习未完成</span><strong>{learningOutstandingCount}</strong></div>
      </div>
      <div className="task-rule-note">任务完成的员工可继续自愿学习；任务未完成的员工须完成产品资料、开口说并通过 90 分考试。未导入任务的员工只要求考试。任务表可直接填写新产品名称，导入后会自动加入当期产品达成率排行。</div>
      <div className="table-card product-task-table">
        <table>
          <thead>
            <tr>
              <th>员工</th>
              <th>门店</th>
              <th>任务达成</th>
              <th>任务状态</th>
              <th>资料学习</th>
              <th>开口说</th>
              <th>最高考试分</th>
              <th>考试状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={8}><div className="empty-state">暂无在职员工</div></td></tr> : rows.map((row) => {
              const learningText = row.status === "completed"
                ? "学习豁免"
                : row.status === "exam-required"
                  ? "不要求资料"
                  : row.productCourses.length === 0
                    ? "待配置资料"
                    : `${row.completedCourses.length}/${row.productCourses.length}${row.learningReady ? " 已完成" : " 未完成"}`;
              const phraseText = row.status === "completed"
                ? "学习豁免"
                : row.status === "exam-required"
                  ? "不要求开口说"
                  : row.productPhrases.length === 0
                    ? "待配置开口说"
                    : `${row.completedPhrases.length}/${row.productPhrases.length}${row.phrasesReady ? " 已完成" : " 未完成"}`;
              const examText = row.status === "completed"
                ? "学习豁免"
                : row.highestExamScore >= 90
                  ? "已通过"
                  : row.highestExamScore > 0 ? "未通过，待重考" : "待考试";
              return (
                <tr key={row.employee.id}>
                  <td><strong>{row.employee.name}</strong><span>{row.employee.position || "未填写职位"}</span></td>
                  <td>{getStoreName(stores, row.employee.storeId)}</td>
                  <td>{row.task ? `${row.completedQuantity}/${row.target}（${row.target > 0 ? Math.min(100, Math.round(row.completedQuantity / row.target * 100)) : 0}%）` : "未导入"}</td>
                  <td><Badge>{taskStatusText(row.status)}</Badge></td>
                  <td className={row.learningReady ? "task-ok" : "task-pending"}>{learningText}</td>
                  <td className={row.phrasesReady ? "task-ok" : "task-pending"}>{phraseText}</td>
                  <td>{row.status === "completed" ? "-" : row.highestExamScore || "-"}</td>
                  <td className={row.highestExamScore >= 90 || row.status === "completed" ? "task-ok" : "task-pending"}>{examText}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <section className="store-sales-admin">
        <SectionHeader
          icon={<Store size={18} />}
          title="门店产品销售达成率"
          subtitle="导入公司下达的门店产品目标与完成量；员工端门店排行仅使用这里的数据，不改变员工任务。"
        />
        <div className="store-sales-toolbar">
          <label>
            <span>产品</span>
            <select value={productKey} onChange={(event) => setSelectedProduct(event.target.value)}>
              {productOptions.length ? productOptions.map((item) => <option key={item} value={item}>{item}</option>) : <option value="">暂无产品</option>}
            </select>
          </label>
          <label>
            <span>统计周期</span>
            <select value={selectedPeriod} onChange={(event) => setSelectedPeriod(event.target.value)}>
              {periods.map((period) => <option key={period} value={period}>{period}</option>)}
            </select>
          </label>
          <label className={`upload-button ${isImportingStoreProductSales ? "disabled" : ""}`}>
            <FileUp size={14} />{isImportingStoreProductSales ? "导入中" : "导入门店销售"}
            <input
              accept=".xlsx,.csv"
              disabled={isImportingStoreProductSales}
              onChange={(event) => {
                onImportStoreSalesFile(event.target.files);
                event.currentTarget.value = "";
              }}
              type="file"
            />
          </label>
          <button className="ghost" onClick={onDownloadStoreSalesTemplate} type="button"><Download size={14} />下载门店销售模板</button>
          <button className="danger" disabled={!productKey || !selectedStoreSales.length} onClick={() => onClearStoreSales({ productKey, periodKey: selectedPeriod })} type="button"><Trash2 size={14} />清除此产品周期</button>
        </div>
        <div className="store-sales-import-note">表格列：门店、产品、统计周期、任务目标、完成数量、达成率。完成数量与达成率至少填写一项；再次导入相同门店/产品/周期会更新原记录。</div>
        <div className="product-task-summary store-sales-summary">
          <div><span>当前产品/周期门店数</span><strong>{selectedStoreSales.length}</strong></div>
          <div><span>平均达成率</span><strong>{selectedStoreSales.length ? `${Math.round(selectedStoreSales.reduce((sum, item) => sum + Number(item.attainmentRate ?? (item.targetQuantity ? item.completedQuantity / item.targetQuantity * 100 : 0)), 0) / selectedStoreSales.length)}%` : "—"}</strong></div>
        </div>
        <div className="table-card store-sales-preview">
          <table>
            <thead><tr><th>名次</th><th>门店</th><th>完成/目标</th><th>销售达成率</th></tr></thead>
            <tbody>
              {selectedStoreSales.length ? selectedStoreSales.map((sale, index) => (
                <tr key={sale.id || `${sale.storeId}-${sale.productKey}-${sale.periodKey}`}>
                  <td>{index + 1}</td>
                  <td><strong>{getStoreName(stores, sale.storeId) === "未知门店" ? sale.storeName || "未知门店" : getStoreName(stores, sale.storeId)}</strong></td>
                  <td>{sale.completedQuantity}/{sale.targetQuantity}</td>
                  <td className="task-ok">{Math.min(100, Math.round(Number(sale.attainmentRate ?? (sale.targetQuantity ? sale.completedQuantity / sale.targetQuantity * 100 : 0))))}%</td>
                </tr>
              )) : <tr><td colSpan={4}><div className="empty-state">当前产品和周期暂无门店销售数据，请下载模板后导入。</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function StoreReceiptReviewPanel({ receipts, stores, reviewCode, onReviewed, onNotice }: { receipts: AdminData["storeReceipts"]; stores: AdminData["stores"]; reviewCode: string; onReviewed: () => Promise<void>; onNotice: (notice: { type: "success" | "error"; message: string }) => void }) {
  const pending = receipts.filter((receipt) => receipt.status === "review");
  async function review(receiptId: string, decision: "approved" | "rejected") {
    try {
      await reviewStoreReceiptAction({ secret: reviewCode, receiptId, decision, rejectReason: decision === "rejected" ? "后台复核未通过" : undefined });
      await onReviewed();
      onNotice({ type: "success", message: decision === "approved" ? "小票已批准并计入门店销售" : "小票已驳回，未计入销售" });
    } catch (error) {
      onNotice({ type: "error", message: error instanceof Error ? error.message : "小票处理失败" });
    }
  }
  return <section className="table-section store-receipt-review" id="store-receipts">
    <SectionHeader icon={<FileImage size={19} />} title="销售小票复核" subtitle="低置信度、门店或单号不明确的小票会出现在这里；批准后才会累计门店销售任务。" />
    <div className="table-card"><table><thead><tr><th>门店</th><th>产品</th><th>小票号</th><th>数量</th><th>识别置信度</th><th>提交时间</th><th>操作</th></tr></thead><tbody>
      {pending.length === 0 ? <tr><td colSpan={7}><div className="empty-state">暂无待复核小票</div></td></tr> : pending.map((receipt) => <tr key={receipt.id}><td>{receipt.storeName || stores.find((store) => store.id === receipt.storeId)?.name || "待确认"}</td><td>{receipt.productKey || "待确认"}</td><td>{receipt.receiptNo || "待确认"}</td><td>{receipt.quantity || 0} 盒</td><td>{Math.round(Number(receipt.confidence || 0) * 100)}%</td><td>{receipt.createdAt ? new Date(receipt.createdAt).toLocaleString("zh-CN") : "-"}</td><td><div className="table-actions"><button type="button" onClick={() => review(receipt.id, "approved")}>批准计入</button><button className="danger" type="button" onClick={() => review(receipt.id, "rejected")}>驳回</button></div></td></tr>)}
    </tbody></table></div>
  </section>;
}

function ExamManagementPanel({
  exams,
  questions,
  examForm,
  importedExamGroups,
  isSavingImportedExams,
  isSaving,
  onChange,
  onQuestionChange,
  onToggleAnswer,
  onAddQuestion,
  onRemoveQuestion,
  onEdit,
  onDelete,
  onReset,
  onSave,
  onImport,
  onImportedGroupChange,
  onImportedQuestionChange,
  onImportedToggleAnswer,
  onSaveImported,
  onClearImported,
  onDownloadTemplate
}: {
  exams: ExamRecord[];
  questions: QuestionRecord[];
  examForm: ExamFormState;
  importedExamGroups: ImportedExamGroupState[];
  isSavingImportedExams: boolean;
  isSaving: boolean;
  onChange: (field: keyof Omit<ExamFormState, "questions">, value: string) => void;
  onQuestionChange: (index: number, field: keyof QuestionFormState, value: string) => void;
  onToggleAnswer: (index: number, answerIndex: string) => void;
  onAddQuestion: () => void;
  onRemoveQuestion: (index: number) => void;
  onEdit: (exam: ExamRecord) => void;
  onDelete: (exam: ExamRecord) => void;
  onReset: () => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
  onImport: (fileList: FileList | null) => void;
  onImportedGroupChange: (groupIndex: number, field: "title" | "productName", value: string) => void;
  onImportedQuestionChange: (groupIndex: number, questionIndex: number, field: keyof QuestionFormState, value: string) => void;
  onImportedToggleAnswer: (groupIndex: number, questionIndex: number, answerIndex: string) => void;
  onSaveImported: () => void;
  onClearImported: () => void;
  onDownloadTemplate: () => void;
}) {
  return (
    <section className="resource-panel exam-manager" id="exams">
      <SectionHeader icon={<ClipboardCheck size={18} />} title="产品题库管理" subtitle="新增、修改产品答题考试与题目" />

      {importedExamGroups.length ? (
        <div className="docx-import-preview">
          <div className="docx-import-preview-head">
            <div>
              <strong>Word 导入预览</strong>
              <span>已拆分为 {importedExamGroups.length} 套子答题，每套 10 题；保存后先进入草稿。</span>
            </div>
            <div className="course-form-actions">
              <button disabled={isSavingImportedExams} onClick={onSaveImported} type="button"><Save size={15} />{isSavingImportedExams ? "保存中" : "保存三套草稿题库"}</button>
              <button className="ghost" disabled={isSavingImportedExams} onClick={onClearImported} type="button">取消导入</button>
            </div>
          </div>
          {importedExamGroups.map((group, groupIndex) => (
            <section className="docx-import-group" key={`${group.title}-${group.index}`}>
              <div className="docx-import-group-head">
                <label><span>子答题标题</span><input value={group.title} onChange={(event) => onImportedGroupChange(groupIndex, "title", event.target.value)} /></label>
                <label><span>产品名称</span><input value={group.productName} onChange={(event) => onImportedGroupChange(groupIndex, "productName", event.target.value)} /></label>
                <Badge>{group.questions.length} 题</Badge>
              </div>
              {group.warnings.length ? <div className="docx-import-warning">需核对：{group.warnings.join("；")}</div> : null}
              <div className="docx-import-question-list">
                {group.questions.map((question, questionIndex) => (
                  <article className="docx-import-question" key={question.id}>
                    <div className="docx-import-question-title"><strong>第 {questionIndex + 1} 题</strong><select value={question.type} onChange={(event) => onImportedQuestionChange(groupIndex, questionIndex, "type", event.target.value)}><option value="single">单选</option><option value="multiple">多选</option></select></div>
                    <textarea value={question.prompt} onChange={(event) => onImportedQuestionChange(groupIndex, questionIndex, "prompt", event.target.value)} rows={2} />
                    <div className="docx-import-options">
                      {["A", "B", "C", "D"].map((letter, optionIndex) => {
                        const field = `option${letter}` as keyof QuestionFormState;
                        return <label key={letter}><input checked={question.answerIndexes.includes(String(optionIndex))} onChange={() => onImportedToggleAnswer(groupIndex, questionIndex, String(optionIndex))} type={question.type === "multiple" ? "checkbox" : "radio"} /><span>{letter}</span><input value={String(question[field] || "")} onChange={(event) => onImportedQuestionChange(groupIndex, questionIndex, field, event.target.value)} /></label>;
                      })}
                    </div>
                    <input value={question.explanation} onChange={(event) => onImportedQuestionChange(groupIndex, questionIndex, "explanation", event.target.value)} placeholder="答案解析（可选）" />
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      <form className="course-form exam-form" onSubmit={onSave}>
        <div className="form-row compact">
          <label>
            <span>产品名称</span>
            <input
              value={examForm.productName}
              onChange={(event) => onChange("productName", event.target.value)}
              placeholder="例如：茴天通络颗粒"
            />
          </label>
          <label>
            <span>发布状态</span>
            <select value={examForm.status} onChange={(event) => onChange("status", event.target.value)}>
              <option value="published">已发布</option>
              <option value="draft">草稿</option>
            </select>
          </label>
        </div>

        <label>
          <span>考试标题</span>
          <input
            value={examForm.title}
            onChange={(event) => onChange("title", event.target.value)}
            placeholder="留空会自动使用 产品名称 + 产品答题"
          />
        </label>

        <div className="form-row compact">
          <label>
            <span>通过线</span>
            <input
              value={examForm.passScore}
              onChange={(event) => onChange("passScore", event.target.value)}
              inputMode="numeric"
            />
          </label>
          <label>
            <span>金豆</span>
            <input
              value={examForm.goldenBeans}
              onChange={(event) => onChange("goldenBeans", event.target.value)}
              inputMode="numeric"
              min="0"
              step="1"
              type="number"
            />
          </label>
        </div>

        <div className="exam-import-toolbar">
          <label className="upload-button">
            <FileUp size={14} />导入答题卡
            <input
              accept=".csv,.json,.docx,text/csv,application/json,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => {
                onImport(event.target.files);
                event.target.value = "";
              }}
              type="file"
            />
          </label>
          <button className="ghost" onClick={onDownloadTemplate} type="button"><Download size={14} />下载模板</button>
        </div>

        <div className="question-editor-list">
          {examForm.questions.map((question, index) => (
            <article className="question-editor" key={question.id}>
              <div className="question-editor-head">
                <strong>第 {index + 1} 题</strong>
                <div>
                  <select
                    value={question.type}
                    onChange={(event) => {
                      const type = event.target.value as "single" | "multiple";
                      onQuestionChange(index, "type", type);
                    }}
                  >
                    <option value="single">单选</option>
                    <option value="multiple">多选</option>
                  </select>
                  <button className="row-action" onClick={() => onRemoveQuestion(index)} type="button">删除</button>
                </div>
              </div>
              <textarea
                value={question.prompt}
                onChange={(event) => onQuestionChange(index, "prompt", event.target.value)}
                placeholder="题干"
                rows={2}
              />
              <div className="option-editor-grid">
                {["A", "B", "C", "D"].map((letter, optionIndex) => {
                  const field = `option${letter}` as keyof QuestionFormState;
                  const value = String(question[field] || "");
                  const checked = question.answerIndexes.includes(String(optionIndex));

                  return (
                    <label className={`option-editor ${checked ? "checked" : ""}`} key={letter}>
                      <input
                        checked={checked}
                        onChange={() => onToggleAnswer(index, String(optionIndex))}
                        type={question.type === "multiple" ? "checkbox" : "radio"}
                      />
                      <span>{letter}</span>
                      <input
                        value={value}
                        onChange={(event) => onQuestionChange(index, field, event.target.value)}
                        placeholder={`选项 ${letter}`}
                      />
                    </label>
                  );
                })}
              </div>
              <input
                value={question.explanation}
                onChange={(event) => onQuestionChange(index, "explanation", event.target.value)}
                placeholder="答案解析（可选）"
              />
            </article>
          ))}
        </div>

        <div className="course-form-actions">
          <button disabled={isSaving} type="submit">
            <Save size={15} />{isSaving ? "保存中" : examForm.examId ? "保存题库" : "新增题库"}
          </button>
          <button className="ghost" onClick={onAddQuestion} type="button">
            <Plus size={15} />增加题目
          </button>
          <button className="ghost" onClick={onReset} type="button">
            <Plus size={15} />新建空白
          </button>
        </div>
      </form>

      <div className="resource-list course-list">
        {exams.map((exam) => {
          const questionCount = questions.filter((question) => question.examId === exam.id).length || exam.questions?.length || 0;
          return (
            <article className="resource-row course-row" key={exam.id}>
              <div>
                <strong>{exam.productName || exam.title}</strong>
                <p>{questionCount} 题 · 通过线 {exam.passScore} · {exam.goldenBeans} 金豆</p>
              </div>
              <Badge>{statusLabel[exam.status]}</Badge>
              <div className="row-actions">
                <button className="row-action" onClick={() => onEdit(exam)} type="button">
                  <Pencil size={14} />编辑
                </button>
                <button aria-label={`删除${exam.title}`} className="row-action danger" onClick={() => onDelete(exam)} title="删除试卷" type="button">
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RewardManagementPanel({
  rewardForm,
  rewards,
  isSaving,
  uploadingImage,
  onChange,
  onEdit,
  onReset,
  onSave,
  onImageUpload
}: {
  rewardForm: RewardFormState;
  rewards: RewardRecord[];
  isSaving: boolean;
  uploadingImage: boolean;
  onChange: (field: keyof RewardFormState, value: string | boolean) => void;
  onEdit: (reward: RewardRecord) => void;
  onReset: () => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
  onImageUpload: (fileList: FileList | null) => void;
}) {
  const sortedRewards = [...rewards].sort((a, b) => Number(a.sortOrder || 999) - Number(b.sortOrder || 999));

  return (
    <section className="resource-panel reward-manager" id="rewards">
      <SectionHeader icon={<Gift size={18} />} title="金豆兑换商品" subtitle="新增商品、上传图片、设置库存和上下架" />

      <form className="course-form reward-form" onSubmit={onSave}>
        <div className="reward-image-field">
          <div className="reward-image-preview">
            {rewardForm.imageUrl ? <img alt="" src={rewardForm.imageUrl} /> : <Gift size={28} />}
          </div>
          <div className="reward-image-controls">
            <AssetInput
              icon={<ImageIcon size={15} />}
              label="商品图片"
              value={rewardForm.imageUrl}
              isUploading={uploadingImage}
              onChange={(value) => onChange("imageUrl", value)}
              onUpload={onImageUpload}
            />
          </div>
        </div>

        <label>
          <span>商品名称</span>
          <input
            value={rewardForm.title}
            onChange={(event) => onChange("title", event.target.value)}
            placeholder="例如：学习之星礼盒"
          />
        </label>

        <textarea
          value={rewardForm.description}
          onChange={(event) => onChange("description", event.target.value)}
          placeholder="商品说明，会显示在 H5 兑换页"
          rows={3}
        />

        <div className="form-row compact">
          <label>
            <span>所需金豆</span>
            <input
              value={rewardForm.goldenBeanPrice}
              onChange={(event) => onChange("goldenBeanPrice", event.target.value)}
              inputMode="numeric"
            />
          </label>
          <label>
            <span>库存</span>
            <input
              value={rewardForm.stock}
              onChange={(event) => onChange("stock", event.target.value)}
              inputMode="numeric"
            />
          </label>
        </div>

        <div className="form-row compact">
          <label>
            <span>状态</span>
            <select value={rewardForm.status} onChange={(event) => onChange("status", event.target.value)}>
              <option value="active">启用</option>
              <option value="inactive">停用</option>
            </select>
          </label>
          <label>
            <span>排序</span>
            <input
              value={rewardForm.sortOrder}
              onChange={(event) => onChange("sortOrder", event.target.value)}
              inputMode="numeric"
            />
          </label>
        </div>

        <label className="admin-compliance-confirm reward-compliance-confirm">
          <input type="checkbox" checked={rewardForm.nonDrugConfirmed} onChange={(event) => onChange("nonDrugConfirmed", event.target.checked)} />
          <span>我确认该礼品不是药品、非处方药、处方药或医疗器械。</span>
        </label>

        <div className="course-form-actions">
          <button disabled={isSaving || !rewardForm.nonDrugConfirmed} type="submit">
            <Save size={15} />{isSaving ? "保存中" : rewardForm.rewardId ? "保存商品" : "新增商品"}
          </button>
          <button className="ghost" onClick={onReset} type="button">
            <Plus size={15} />新建空白
          </button>
        </div>
      </form>

      <div className="resource-list course-list">
        {sortedRewards.map((reward) => (
          <article className="resource-row reward-row" key={reward.id}>
            <div className="reward-thumb">
              {reward.imageUrl ? <img alt="" src={reward.imageUrl} /> : <Gift size={18} />}
            </div>
            <div>
              <strong>{reward.title}</strong>
              <p>{reward.goldenBeanPrice} 金豆 · 库存 {reward.stock} · {reward.description || "暂无说明"}</p>
            </div>
            <Badge>{reward.nonDrugConfirmed ? statusLabel[reward.status] : "未完成非药品确认"}</Badge>
            <button className="row-action" onClick={() => onEdit(reward)} type="button">
              <Pencil size={14} />编辑
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function StoreTaskRewardManagementPanel({
  form,
  products,
  rewards,
  isSaving,
  onChange,
  onEdit,
  onSave
}: {
  form: StoreTaskRewardFormState;
  products: string[];
  rewards: StoreTaskRewardRecord[];
  isSaving: boolean;
  onChange: (field: keyof StoreTaskRewardFormState, value: string) => void;
  onEdit: (reward: StoreTaskRewardRecord) => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return <section className="resource-panel store-task-reward-manager">
    <SectionHeader icon={<Store size={18} />} title="门店任务兑换品" subtitle="独立于金豆兑换，按门店已完成销售盒数发放领取额度" />
    <form className="course-form" onSubmit={onSave}>
      <label>
        <span>关联产品</span>
        <select value={form.productKey} onChange={(event) => onChange("productKey", event.target.value)}>
          {products.length ? products.map((product) => <option key={product} value={product}>{product}</option>) : <option value="">暂无产品</option>}
        </select>
      </label>
      <label>
        <span>领取商品名称</span>
        <input value={form.title} onChange={(event) => onChange("title", event.target.value)} placeholder="例如：示例产品A 1盒" />
      </label>
      <label>
        <span>领取说明</span>
        <textarea value={form.description} onChange={(event) => onChange("description", event.target.value)} rows={2} />
      </label>
      <div className="form-row compact">
        <label>
          <span>商品价值（元）</span>
          <input inputMode="decimal" min="0" step="0.01" value={form.itemValue} onChange={(event) => onChange("itemValue", event.target.value)} />
        </label>
        <label>
          <span>每满 10 盒领取</span>
          <input value="1 次门店共享额度" readOnly />
        </label>
      </div>
      <label>
        <span>状态</span>
        <select value={form.status} onChange={(event) => onChange("status", event.target.value)}><option value="active">启用</option><option value="inactive">停用</option></select>
      </label>
      <p className="admin-help-copy">这是门店共享领取额度，不计入金豆，不进入普通金豆兑换商品校验；员工可在员工端申请，后台“兑换记录”中确认发放。</p>
      <div className="course-form-actions"><button disabled={isSaving || !products.length} type="submit"><Save size={15} />{isSaving ? "保存中" : "保存任务兑换品"}</button></div>
    </form>
    <div className="resource-list course-list">
      {rewards.map((reward) => <article className="resource-row" key={reward.id}>
        <div><strong>{reward.title}</strong><p>{reward.productKey} · 每满 {reward.threshold} 盒 1 次 · 商品价值 ¥{reward.itemValue}</p></div>
        <Badge>{reward.status === "active" ? "启用" : "停用"}</Badge>
        <button className="row-action" onClick={() => onEdit(reward)} type="button"><Pencil size={14} />编辑</button>
      </article>)}
    </div>
  </section>;
}

function ResourcePanel({
  id,
  icon,
  title,
  items
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  items: Array<{ title: string; meta: string; status: string }>;
}) {
  return (
    <section className="resource-panel" id={id}>
      <SectionHeader icon={icon} title={title} subtitle="内容数据与发布状态" />
      <div className="resource-list">
        {items.map((item) => (
          <article className="resource-row" key={item.title}>
            <div>
              <strong>{item.title}</strong>
              <p>{item.meta}</p>
            </div>
            <Badge>{item.status}</Badge>
          </article>
        ))}
      </div>
    </section>
  );
}

function AdminAccessView({ error, onSubmit }: { error: string; onSubmit: (secret: string) => void }) {
  const [secret, setSecret] = useState("");
  return (
    <main className="admin-access-screen">
      <section className="admin-access-panel">
        <div className="admin-access-brand">
          <img src={brandLogoUrl} alt="" />
          <div><strong>{brandConfig.shortName}</strong><span>{brandConfig.adminSubtitle}</span></div>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); onSubmit(secret); }}>
          <label>
            <span>管理访问口令</span>
            <input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="current-password" autoFocus />
          </label>
          {error ? <p className="admin-access-error">{error}</p> : null}
          <button type="submit" disabled={!secret.trim()}><LockKeyhole size={17} />进入管理后台</button>
        </form>
      </section>
    </main>
  );
}

function AdminLoadingView() {
  return (
    <main className="admin-access-screen">
      <section className="admin-access-panel admin-loading-panel">
        <img src={brandLogoUrl} alt="" />
        <strong>正在验证管理权限</strong>
      </section>
    </main>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="badge">{children}</span>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
