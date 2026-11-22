import {
  courses as fallbackCourses,
  employees as fallbackEmployees,
  exams as fallbackExams,
  goldenBeanLedger as fallbackGoldenBeanLedger,
  phrases as fallbackPhrases,
  redemptions as fallbackRedemptions,
  demoRewards as fallbackRewards,
  stores as fallbackStores,
  submissions as fallbackSubmissions
} from "@open-training/shared";
import type { GoldenBeanLedgerEntry, Redemption, Reward, Store, Submission } from "@open-training/shared";
import type { ActionResult, CasePost, EmployeeAppData } from "./data";
import { demoPolicy } from "./data";
import { bindDemoEmployeeData } from "./demoAuthCore.js";
import { deleteDemoMedia, demoMediaUrl, isDemoMediaId, resetDemoMedia, saveDemoMedia } from "./demoMedia";
import { reduceDemoAction, restoreDemoState, serializeDemoState } from "./demoStoreCore.js";
import type { DemoActionName } from "./demoStoreCore.js";

const storageKey = "employee-h5-demo-state";
const fallbackEmployee = fallbackEmployees[0];
const demoEmployeeDirectory = [
  { ...fallbackEmployee },
  { ...fallbackEmployee, id: "demo-duplicate-1", name: "测试同名", employeeNo: "DEMO2001" },
  { ...fallbackEmployee, id: "demo-duplicate-2", name: "测试同名", employeeNo: "DEMO2002" }
];
let currentData: EmployeeAppData | null = null;
const listeners = new Set<(data: EmployeeAppData) => void>();

function plainClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function currentDemoPeriod() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function demoProductTaskRankings(storeName: string): EmployeeAppData["productTaskRankings"] {
  const employeeBase = { ...fallbackEmployee, store: storeName };
  const rows = [
    { ...employeeBase, id: fallbackEmployee.id, name: "预览员工", employeeNo: "DEMO-001" },
    { ...employeeBase, id: "demo-ranking-2", name: "员工二", employeeNo: "DEMO-002" },
    { ...employeeBase, id: "demo-ranking-3", name: "员工三", employeeNo: "DEMO-003" }
  ];
  const periodKey = currentDemoPeriod();
  const ranking = (productName: string, values: Array<[number, number]>) => ({
    productKey: productName,
    productName,
    periodKey,
    rows: rows.map((employee, index) => {
      const [targetQuantity, completedQuantity] = values[index];
      return {
        ...employee,
        targetQuantity,
        completedQuantity,
        attainmentRate: Math.min(100, Math.round(completedQuantity / targetQuantity * 100))
      };
    })
  });
  return [
    ranking("示例产品A", [[10, 9], [2, 3], [10, 7]]),
    ranking("示例产品B", [[5, 5], [10, 8], [10, 6]]),
    ranking("示例产品C", [[10, 7], [10, 9], [4, 5]])
  ];
}

function demoStoreProductRankings(): EmployeeAppData["storeProductRankings"] {
  const periodKey = currentDemoPeriod();
  const rows = [
    { id: "demo-store-1", storeId: "demo-store-1", storeName: "示例门店一", targetQuantity: 10, completedQuantity: 10, attainmentRate: 100, rank: 1 },
    { id: "demo-store-2", storeId: "demo-store-2", storeName: "示例门店", targetQuantity: 10, completedQuantity: 9, attainmentRate: 90, rank: 2 },
    { id: "demo-store-3", storeId: "demo-store-3", storeName: "佛山禅城店", targetQuantity: 10, completedQuantity: 8, attainmentRate: 80, rank: 3 }
  ];
  return ["示例产品A", "示例产品B", "示例产品C"].map((productName) => ({
    productKey: productName,
    productName,
    periodKey,
    rows
  }));
}

function demoRankingEmployees(storeName: string): EmployeeAppData["ranking"] {
  const rows = [
    { id: fallbackEmployee.id, name: "预览员工", employeeNo: "DEMO-001", courseCompletionRate: 75, goldenBeans: 82, notificationAcknowledgedCount: 3, notificationRequiredCount: 4 },
    { id: "demo-ranking-2", name: "陈晓丽", employeeNo: "DEMO-002", courseCompletionRate: 100, goldenBeans: 120, notificationAcknowledgedCount: 4, notificationRequiredCount: 4 },
    { id: "demo-ranking-3", name: "李敏", employeeNo: "DEMO-003", courseCompletionRate: 63, goldenBeans: 96, notificationAcknowledgedCount: 2, notificationRequiredCount: 4 },
    { id: "demo-ranking-4", name: "王芳", employeeNo: "DEMO-004", courseCompletionRate: 38, goldenBeans: 55, notificationAcknowledgedCount: 1, notificationRequiredCount: 4 }
  ];
  return rows.map((row, index) => {
    const required = Number(row.notificationRequiredCount || 0);
    const acknowledged = Number(row.notificationAcknowledgedCount || 0);
    const firstProductRate = Number(row.courseCompletionRate || 0);
    const secondProductRate = Math.max(0, firstProductRate - 25);
    return {
      ...fallbackEmployee,
      ...row,
      store: storeName,
      notificationAcknowledgementHasData: required > 0,
      notificationAcknowledgementRate: required ? Math.round(acknowledged / required * 100) : 0,
      pendingNotifications: Array.from({ length: Math.max(0, required - acknowledged) }, (_, notificationIndex) => ({
        caseId: `demo-notice-${notificationIndex + 1}`,
        title: ["本周示例产品A活动通知", "示例产品B课程资料更新", "门店陈列执行通知"][notificationIndex % 3],
        productName: ["示例产品A", "示例产品B", "示例事业部"][notificationIndex % 3],
        createdAt: `2026-10-${String(15 - notificationIndex).padStart(2, "0")} 09:00:00`
      })),
      productLearningDetails: [
        { productKey: "示例产品A", productName: "示例产品A", completedUnitCount: Math.round(firstProductRate / 25), unitCount: 4, completionRate: firstProductRate },
        { productKey: "示例产品B", productName: "示例产品B", completedUnitCount: Math.round(secondProductRate / 25), unitCount: 4, completionRate: secondProductRate },
        { productKey: "金尔力", productName: "金尔力", completedUnitCount: index === 1 ? 3 : 0, unitCount: 3, completionRate: index === 1 ? 100 : 0 }
      ]
    };
  });
}

function localAdminPreviewEnabled() {
  return new URLSearchParams(window.location.search).get("admin") === "1";
}

function demoCases(employeeId: string): CasePost[] {
  return [
    {
      id: "demo-notice-1",
      type: "case",
      title: "本周示例产品A活动通知",
      content: "请各门店员工查看活动规则和陈列要求，阅读后点击确认已收到。",
      employeeId: "demo-admin",
      storeId: "",
      publisherName: "学习运营台",
      publisherRole: "admin",
      createdAt: "2026-10-15 09:00:00",
      status: "approved",
      goldenBeans: 0,
      productName: "示例产品A",
      acknowledgementRequired: true,
      acknowledgementStatus: "pending",
      acknowledgementTargetCount: 4,
      acknowledgementAcknowledgedCount: employeeId === "demo-ranking-2" ? 4 : 3,
      acknowledgementPendingCount: employeeId === "demo-ranking-2" ? 0 : 1,
      comments: [],
      commentCount: 0
    },
    {
      id: "demo-notice-2",
      type: "case",
      title: "示例产品B课程资料更新",
      content: "示例产品B培训资料已更新，请及时查看。",
      employeeId: "demo-admin",
      storeId: "",
      publisherName: "学习运营台",
      publisherRole: "admin",
      createdAt: "2026-10-14 09:00:00",
      status: "approved",
      goldenBeans: 0,
      productName: "示例产品B",
      acknowledgementRequired: true,
      acknowledgementStatus: "acknowledged",
      acknowledgedAt: "2026-10-14 10:30:00",
      acknowledgementTargetCount: 4,
      acknowledgementAcknowledgedCount: 4,
      acknowledgementPendingCount: 0,
      comments: [],
      commentCount: 0
    }
  ];
}

function initialData(): EmployeeAppData {
  const store = fallbackStores.find((item) => item.id === fallbackEmployee.storeId);
  const storeName = store?.name || "示例门店";
  const ranking = demoRankingEmployees(storeName);
  const employee = localAdminPreviewEnabled()
    ? { ...fallbackEmployee, id: "demo-admin", name: "本地管理员", employeeNo: "ADMIN-DEMO", role: "admin" as const, store: "示例企业总部", region: "总部" }
    : { ...fallbackEmployee, ...ranking.find((item) => item.id === fallbackEmployee.id), store: storeName, region: "示例区域" };
  const cases = demoCases(employee.id);
  return {
    source: "fallback",
    bound: true,
    employee,
    stores: plainClone(fallbackStores) as Store[],
    courses: fallbackCourses.filter((item) => item.status === "published").map((item) => ({ ...item, hasVideo: Boolean(item.videoUrl || item.videoFileId) })),
    phrases: fallbackPhrases.filter((item) => item.status === "published").map((item) => ({ ...item })),
    exams: fallbackExams.filter((item) => item.status === "published").map((item) => ({ ...item, passScore: 90, questions: item.questions.map((question) => ({ ...question, options: [...question.options] })) })),
    productTaskStatuses: [],
    productTaskRankings: demoProductTaskRankings(storeName),
    storeProductRankings: demoStoreProductRankings(),
    storeTaskRewards: [{
      id: "demo-store-task-reward-yanrong",
      eligible: true,
      productKey: "示例产品A",
      title: "示例产品A 1盒",
      description: "每完成 10 盒门店销售任务，可领取 1 盒。",
      itemValue: 498,
      threshold: 10,
      status: "active",
      periodKey: currentDemoPeriod(),
      storeId: fallbackEmployee.storeId,
      storeName,
      targetQuantity: 10,
      completedQuantity: 10,
      earnedCount: 1,
      claimedCount: 0,
      availableCount: 1
    }],
    rewards: plainClone(fallbackRewards.filter((item) => item.status === "active" && item.nonDrugConfirmed === true)) as Reward[],
    submissions: plainClone(fallbackSubmissions.filter((item) => item.employeeId === fallbackEmployee.id)) as Submission[],
    cases,
    ranking,
    goldenBeanLedger: plainClone(fallbackGoldenBeanLedger.filter((item) => item.employeeId === fallbackEmployee.id)) as GoldenBeanLedgerEntry[],
    redemptions: plainClone(fallbackRedemptions.filter((item) => item.employeeId === fallbackEmployee.id)) as Redemption[],
    recordings: [],
    learningTodos: [],
    learningTodoCount: 0,
    notificationPreference: { enabled: false, status: "not-enabled", updatedAt: "" },
    policy: demoPolicy()
  };
}

async function hydrateMedia(data: EmployeeAppData) {
  const hydrateSubmission = async <T extends Submission | CasePost>(item: T): Promise<T> => {
    const images = item.images ? await Promise.all(item.images.map(async (image) => isDemoMediaId(image.fileId)
      ? { ...image, url: await demoMediaUrl(image.fileId) }
      : image)) : undefined;
    const videoUrl = isDemoMediaId(item.videoFileId) ? await demoMediaUrl(item.videoFileId) : item.videoUrl;
    return { ...item, ...(images ? { images } : {}), ...(videoUrl ? { videoUrl } : {}) };
  };
  return {
    ...data,
    submissions: await Promise.all(data.submissions.map(hydrateSubmission)),
    cases: await Promise.all(data.cases.map(hydrateSubmission))
  };
}

function persist(data: EmployeeAppData) {
  try {
    window.localStorage?.setItem(storageKey, serializeDemoState(data));
  } catch {
    // Demo mode remains usable in memory when an embedded browser blocks storage.
  }
}

function restoredState() {
  try {
    return window.localStorage?.getItem(storageKey) || null;
  } catch {
    return null;
  }
}

function emit(data: EmployeeAppData) {
  listeners.forEach((listener) => listener(data));
}

export type DemoAction = {
  type: DemoActionName;
  payload?: Record<string, any>;
};

export async function loadDemoData() {
  if (currentData) return currentData;
  const fallback = initialData();
  const restored = restoreDemoState(restoredState(), fallback);
  // The explicit local preview role belongs to the URL, not persisted demo
  // progress. This keeps admin-only detail checks separate from employee view.
  currentData = await hydrateMedia({ ...restored, employee: fallback.employee });
  persist(currentData);
  return currentData;
}

/** 本地验收用供应商视图：只返回授权产品及其学习数据，不改变普通员工演示状态。 */
export async function loadSupplierDemoData(): Promise<EmployeeAppData> {
  const base = initialData();
  const supplierId = "demo-supplier";
  const supplierProducts = ["示例产品A"];
  const supplier = {
    ...base.employee,
    id: supplierId,
    name: "示例供应商",
    employeeNo: "SUPPLIER-001",
    role: "supplier" as const,
    position: "供应商",
    supplierName: "示例产品A厂家",
    supplierProductKeys: supplierProducts,
    goldenBeans: 0,
    courseCompletionRate: 0,
    examPassRate: 0
  };
  const ranking = base.ranking.filter((item) => item.role !== "supplier").map((item, index) => ({
    ...item,
    goldenBeans: 0,
    productGoldenBeans: Object.fromEntries(supplierProducts.map((product) => [product, Math.max(0, 30 - index * 5)])),
    productCompletionRates: Object.fromEntries(supplierProducts.map((product) => {
      const productCourses = base.courses.filter((course) => course.productName === product);
      const courseRate = productCourses.length
        ? Math.round(productCourses.reduce((sum, course) => sum + (course.completed ? 100 : Number(course.progress || 0)), 0) / productCourses.length)
        : 0;
      return [product, item.id === base.employee.id ? courseRate : 0];
    }))
  }));
  return {
    ...base,
    // 供应商仍使用原员工端版式；供应商身份只用于权限和统计，不改变员工端页面结构。
    employee: { ...supplier, store: base.employee.store || "示例企业", region: base.employee.region || "" },
    courses: base.courses.filter((item) => supplierProducts.includes(item.productName || "")),
    phrases: base.phrases.filter((item) => supplierProducts.includes(item.productName || "")),
    exams: base.exams.filter((item) => supplierProducts.includes(item.productName || "")),
    cases: base.cases.filter((item) => item.productName && supplierProducts.includes(item.productName) && (item.visibleSupplierIds || []).includes(supplierId)),
    submissions: [],
    ranking,
    productTaskRankings: base.productTaskRankings.filter((item) => supplierProducts.includes(item.productKey)),
    storeProductRankings: [],
    storeTaskRewards: [{
      id: "demo-supplier-store-task-reward-yanrong",
      eligible: false,
      productKey: "示例产品A",
      title: "示例产品A 1盒",
      description: "完成门店销售任务，可领取一盒",
      itemValue: 498,
      threshold: 10,
      status: "active",
      periodKey: "2026-09",
      storeId: "",
      storeName: "",
      targetQuantity: 0,
      completedQuantity: 0,
      earnedCount: 0,
      claimedCount: 0,
      availableCount: 0
    }],
    isSupplier: true,
    supplierLabel: "供应商｜示例产品A厂家"
  };
}

export async function loadDemoBindingAuth() {
  const data = await loadDemoData();
  return { stores: plainClone(data.stores) };
}

export async function bindDemoEmployee(storeId: string, employeeName: string): Promise<ActionResult & { nextData: EmployeeAppData }> {
  const data = await loadDemoData();
  const result = bindDemoEmployeeData(data, demoEmployeeDirectory, storeId, employeeName);
  currentData = result.nextData;
  persist(currentData);
  emit(currentData);
  return {
    message: "登录成功",
    data: { employee: result.employee },
    nextData: currentData
  };
}

export function subscribeDemoData(listener: (data: EmployeeAppData) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function runDemoAction(action: DemoAction): Promise<ActionResult & { nextData: EmployeeAppData }> {
  const data = await loadDemoData();
  const payload = { ...(action.payload || {}) };
  const storedFileIds: string[] = [];
  try {
    if (action.type === "submitPhrase" && payload.blob instanceof Blob) {
      const [media] = await saveDemoMedia([payload.blob]);
      storedFileIds.push(media.fileId);
      payload.recordingFileId = media.fileId;
      delete payload.blob;
    }
    if (action.type === "publishCase" && Array.isArray(payload.files) && payload.files.length) {
      const media = await saveDemoMedia(payload.files);
      storedFileIds.push(...media.map((item) => item.fileId));
      const video = media.find((item) => item.type.startsWith("video/"));
      payload.images = video ? [] : media.map((item) => ({ fileId: item.fileId, url: item.url, size: item.size }));
      payload.video = video ? { fileId: video.fileId, url: video.url, size: video.size } : null;
      delete payload.files;
    }
    const result = reduceDemoAction(data, action.type, payload);
    if (action.type === "deleteRecording" && payload.fileId) {
      await deleteDemoMedia([payload.fileId]).catch(() => undefined);
    }
    currentData = result.nextData;
    persist(currentData);
    emit(currentData);
    return { message: result.message, data: result.data, nextData: currentData };
  } catch (error) {
    await deleteDemoMedia(storedFileIds).catch(() => undefined);
    throw error;
  }
}

export async function recordDemoCourseLearningProgress(courseId: string, resourceType: "video" | "ppt") {
  const data = await loadDemoData();
  const result = reduceDemoAction(data, "recordCourseLearningProgress", { courseId, resourceType });
  currentData = result.nextData;
  persist(currentData);
  emit(currentData);
  return currentData;
}

export async function resetDemoData() {
  await resetDemoMedia();
  currentData = initialData();
  persist(currentData);
  emit(currentData);
  return currentData;
}
