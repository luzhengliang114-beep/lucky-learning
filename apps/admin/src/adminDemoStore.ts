import type { AdminData } from "./data";
import { buildSupplierViews } from "./supplierMetrics";
import { exactOrganizationMatch, organizationDisplayName } from "@open-training/shared";

const storageKey = "open-training-admin-demo-state-v2";
const mediaDatabaseName = "open-training-admin-demo-media";
const mediaStoreName = "files";
const demoMediaPrefix = "demo-media:";

let currentData: AdminData | null = null;
const objectUrls = new Map<string, string>();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readStoredData() {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.data && Array.isArray(parsed.data.courses) ? parsed.data as AdminData : null;
  } catch {
    return null;
  }
}

function persist() {
  if (!currentData) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ version: 1, data: currentData }));
  } catch {
    // Large uploaded media stays in IndexedDB; data editing remains available in memory.
  }
}

function appendMissingRewards(data: AdminData, fallback: AdminData) {
  const fallbackRewardsById = new Map(fallback.rewards.map((reward) => [reward.id, reward]));
  data.rewards = (data.rewards || []).map((reward) => (
    reward.imageUrl === "/rewards/cartoon-cat.png" && fallbackRewardsById.has(reward.id)
      ? { ...reward, imageUrl: fallbackRewardsById.get(reward.id)?.imageUrl || reward.imageUrl }
      : reward
  ));
  const rewardIds = new Set((data.rewards || []).map((reward) => reward.id));
  data.rewards = [
    ...(data.rewards || []),
    ...clone(fallback.rewards.filter((reward) => !rewardIds.has(reward.id)))
  ];
}

function appendMissingCourses(data: AdminData, fallback: AdminData) {
  const courseIds = new Set((data.courses || []).map((course) => course.id));
  data.courses = [
    ...(data.courses || []),
    ...clone(fallback.courses.filter((course) => !courseIds.has(course.id)))
  ];
}

function recalculateDashboard(data: AdminData) {
  const staff = data.employees.filter((employee) => employee.role !== "supplier");
  data.dashboardStats = {
    totalEmployees: staff.length,
    averageCompletion: staff.length
      ? Math.round(staff.reduce((sum, item) => sum + Number(item.courseCompletionRate || 0), 0) / staff.length)
      : 0,
    examPassRate: staff.length
      ? Math.round(staff.reduce((sum, item) => sum + Number(item.examPassRate || 0), 0) / staff.length)
      : 0,
    pendingReviews: data.submissions.filter((item) => item.status === "pending").length,
    pendingEmployeeApplications: (data.employeeApplications || []).filter((item) => item.status === "pending").length,
    issuedGoldenBeans: data.goldenBeanLedger.filter((item) => item.delta > 0).reduce((sum, item) => sum + item.delta, 0)
  };
}

function recalculateSupplierViews(data: AdminData) {
  data.supplierViews = buildSupplierViews({
    employees: data.employees,
    stores: data.stores,
    courses: data.courses,
    phrases: data.phrases,
    exams: data.exams,
    courseProgress: data.courseProgress,
    phrasePracticeAttempts: data.phrasePracticeAttempts,
    goldenBeanLedger: data.goldenBeanLedger,
    examAttempts: data.examAttempts,
    employeeProductTasks: data.employeeProductTasks
  });
}

function openMediaDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(mediaDatabaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(mediaStoreName)) {
        request.result.createObjectStore(mediaStoreName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("本地素材库打开失败"));
  });
}

async function mediaRecord(mediaId: string) {
  if (!mediaId.startsWith(demoMediaPrefix) || !window.indexedDB) return null;
  const database = await openMediaDatabase();
  return new Promise<{ id: string; blob: Blob; name: string; contentType: string } | null>((resolve, reject) => {
    const transaction = database.transaction(mediaStoreName, "readonly");
    const request = transaction.objectStore(mediaStoreName).get(mediaId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("本地素材读取失败"));
    transaction.oncomplete = () => database.close();
  });
}

async function resolveMedia(value = "") {
  if (!value.startsWith(demoMediaPrefix)) return value;
  const cached = objectUrls.get(value);
  if (cached) return cached;
  const record = await mediaRecord(value);
  if (!record) return "";
  const url = URL.createObjectURL(record.blob);
  objectUrls.set(value, url);
  return url;
}

async function hydrate(data: AdminData): Promise<AdminData> {
  const next = clone(data);
  next.source = "demo";
  next.courses = await Promise.all(next.courses.map(async (course) => ({
    ...course,
    productImageUrl: await resolveMedia(course.productImage || course.productImageUrl || ""),
    coverImageUrl: await resolveMedia(course.coverImage || course.coverImageUrl || ""),
    videoUrl: await resolveMedia(course.videoFileId || course.videoUrl || "")
  })));
  next.phrases = await Promise.all(next.phrases.map(async (phrase) => ({
    ...phrase,
    audioUrl: await resolveMedia(phrase.audioFileId || phrase.audioUrl || "")
  })));
  next.submissions = await Promise.all(next.submissions.map(async (submission) => ({
    ...submission,
    images: submission.images
      ? await Promise.all(submission.images.map(async (image) => ({ ...image, url: await resolveMedia(image.fileId || image.imageUrl || image.url || "") })))
      : undefined,
    videoUrl: await resolveMedia(submission.videoFileId || submission.videoUrl || "")
  })));
  next.rewards = await Promise.all(next.rewards.map(async (reward) => ({
    ...reward,
    imageUrl: await resolveMedia(reward.imageFileId || reward.imageUrl || "")
  })));
  return next;
}

export async function loadAdminDemoData(fallback: AdminData) {
  if (!currentData) {
    currentData = readStoredData() || { ...clone(fallback), source: "demo" };
    currentData.source = "demo";
    currentData.employeeApplications ||= clone(fallback.employeeApplications);
    currentData.storeProductSales ||= clone(fallback.storeProductSales || []);
    currentData.storeTaskRewards ||= clone(fallback.storeTaskRewards || []);
    appendMissingRewards(currentData, fallback);
    appendMissingCourses(currentData, fallback);
    recalculateDashboard(currentData);
    recalculateSupplierViews(currentData);
    persist();
  }
  return hydrate(currentData);
}

function data() {
  if (!currentData) throw new Error("本地后台数据尚未初始化");
  return currentData;
}

function upsert<T extends { id: string }>(items: T[], value: T) {
  const index = items.findIndex((item) => item.id === value.id);
  if (index >= 0) items[index] = value;
  else items.unshift(value);
}

export async function runAdminDemoAction(action: string, payload: Record<string, any>) {
  const state = data();
  const now = new Date().toISOString();

  if (action === "saveStore") {
    const id = payload.storeId || createId("store");
    const brand = state.brands.find((item) => item.id === payload.brandId && item.status !== "inactive");
    if (!brand) throw new Error("请选择有效品牌");
    upsert(state.stores, {
      id,
      name: String(payload.name || "").trim(),
      regionId: payload.regionId || "default",
      brandId: brand.id,
      brandName: brand.name,
      storeNo: String(payload.storeNo || "").trim(),
      address: String(payload.address || "").trim(),
      organizationType: payload.organizationType === "department" ? "department" : "store",
      status: payload.status === "inactive" ? "inactive" : "active"
    });
  } else if (action === "importEmployees") {
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const errors: Array<{ rowNumber: number; name?: string; message: string }> = [];
    const items = rows.map((row: any, index: number) => {
      const brandName = String(row.brandName || "").trim();
      const store = state.stores.find((item) => (item.brandId === brandName || item.brandName === brandName) && item.name === String(row.storeName || "").trim() && item.status !== "inactive");
      const name = String(row.name || "").trim();
      const position = String(row.position || "").trim();
      const rowNumber = Number(row.rowNumber || index + 2);
      if (!name || !position || !store) {
        errors.push({ rowNumber, name, message: !store ? "找不到启用的门店/部门" : !position ? "缺少职位" : "缺少姓名" });
        return null;
      }
      const existing = state.employees.find((employee) => (
        (row.employeeNo && employee.employeeNo === String(row.employeeNo).trim())
        || (!row.employeeNo && employee.storeId === store.id && employee.name === name)
      ));
      return {
        rowNumber,
        action: existing ? "update" as const : "create" as const,
        employeeId: existing?.id || "",
        document: {
          name,
          position,
          employeeNo: String(row.employeeNo || existing?.employeeNo || `IMP-DEMO-${rowNumber}`).trim(),
          role: row.role === "管理员" ? "admin" : row.role === "店长" ? "storeManager" : row.role === "供应商" ? "supplier" : "employee",
          status: row.status === "停用" ? "inactive" : "active",
          storeId: store.id,
          regionId: store.regionId || "default"
        }
      };
    }).filter(Boolean) as Array<{ rowNumber: number; action: "create" | "update"; employeeId: string; document: any }>;
    const result = {
      committed: payload.dryRun !== true && errors.length === 0,
      items: errors.length > 0 ? [] : items,
      errors,
      summary: {
        total: rows.length,
        created: errors.length ? 0 : items.filter((item) => item.action === "create").length,
        updated: errors.length ? 0 : items.filter((item) => item.action === "update").length,
        skipped: 0,
        failed: errors.length
      }
    };
    if (result.committed) {
      items.forEach((item) => upsert(state.employees, {
        id: item.employeeId || createId("employee"),
        ...item.document,
        goldenBeans: state.employees.find((employee) => employee.id === item.employeeId)?.goldenBeans || 0,
        courseCompletionRate: state.employees.find((employee) => employee.id === item.employeeId)?.courseCompletionRate || 0,
        examPassRate: state.employees.find((employee) => employee.id === item.employeeId)?.examPassRate || 0
      }));
      recalculateDashboard(state);
      persist();
    }
    return result;
  } else if (action === "saveEmployee") {
    const id = payload.employeeId || createId("employee");
    let storeId = payload.storeId;
    if (payload.role === "supplier") {
      let supplierStore = state.stores.find((item) => item.name === "供应商");
      if (!supplierStore) {
        const brand = state.brands.find((item) => item.status !== "inactive");
        if (!brand) throw new Error("请先创建品牌");
        supplierStore = { id: "supplier-organization", name: "供应商", regionId: "default", brandId: brand.id, brandName: brand.name, storeNo: "SUPPLIER", address: "", organizationType: "department", status: "active" };
        state.stores.push(supplierStore);
      }
      storeId = supplierStore.id;
    }
    upsert(state.employees, {
      id,
      name: String(payload.name || "").trim(),
      employeeNo: String(payload.employeeNo || "").trim(),
      position: String(payload.position || "").trim(),
      role: ["storeManager", "admin", "supplier"].includes(payload.role) ? payload.role : "employee",
      storeId,
      regionId: payload.regionId || "default",
      goldenBeans: Number(payload.goldenBeans || 0),
      courseCompletionRate: Number(payload.courseCompletionRate || 0),
      examPassRate: Number(payload.examPassRate || 0),
      status: payload.status === "inactive" ? "inactive" : "active",
      supplierName: payload.role === "supplier" ? String(payload.supplierName || "").trim() : "",
      supplierProductKeys: payload.role === "supplier" && Array.isArray(payload.supplierProductKeys) ? payload.supplierProductKeys.map(String) : []
    });
    recalculateSupplierViews(state);
  } else if (action === "saveCourse") {
    const id = payload.courseId || createId("course");
    const videoValue = String(payload.videoUrl || payload.videoFileId || "");
    upsert(state.courses, {
      id,
      title: String(payload.title || "").trim(),
      duration: payload.duration || "10 分钟",
      description: String(payload.description || "").trim(),
      goldenBeans: Number(payload.goldenBeans || 0),
      completionRate: 0,
      status: payload.status === "draft" ? "draft" : "published",
      track: payload.track === "chronic" ? "chronic" : "product",
      productName: String(payload.productName || "").trim(),
      productImage: String(payload.productImage || ""),
      chronicCategory: payload.chronicCategory,
      coverImage: String(payload.coverImage || ""),
      videoFileId: videoValue.startsWith(demoMediaPrefix) ? videoValue : "",
      videoUrl: videoValue.startsWith(demoMediaPrefix) ? "" : videoValue,
      resourceType: payload.resourceType || undefined,
      resourceUrl: String(payload.resourceUrl || ""),
      resourceName: String(payload.resourceName || ""),
      slideCount: Number(payload.slideCount || 0),
      slideImageFileIds: Array.isArray(payload.slideImageFileIds) ? payload.slideImageFileIds : [],
      slideImagePrefix: String(payload.slideImagePrefix || ""),
      slideMinSeconds: payload.resourceType === "ppt" ? 3 : Number(payload.slideMinSeconds || 3),
      pptProcessingStatus: payload.pptProcessingStatus || undefined,
      pptConversionJobId: String(payload.pptConversionJobId || "") || undefined,
      sortOrder: Number(payload.sortOrder || 999)
    });
  } else if (action === "savePhrase") {
    const id = payload.phraseId || createId("phrase");
    const audioValue = String(payload.audioFileId || payload.audioUrl || "");
    const previous = state.phrases.find((item) => item.id === id);
    upsert(state.phrases, {
      id,
      title: String(payload.title || "").trim(),
      script: String(payload.script || "").trim(),
      productName: String(payload.productName || "").trim(),
      audioFileId: audioValue.startsWith(demoMediaPrefix) ? audioValue : "",
      audioUrl: audioValue.startsWith(demoMediaPrefix) ? "" : audioValue,
      audioName: String(payload.audioName || ""),
      goldenBeans: Number(payload.goldenBeans || 0),
      maxRewardedAttempts: Math.max(1, Number(payload.maxRewardedAttempts || 1)),
      submissions: Number(previous?.submissions || 0),
      status: payload.status === "draft" ? "draft" : "published",
      sortOrder: Number(payload.sortOrder || 999)
    });
  } else if (action === "saveExam") {
    const id = payload.examId || createId("exam");
    const questions = (payload.questions || []).map((question: any, index: number) => ({
      id: `${id}-question-${index + 1}`,
      examId: id,
      prompt: String(question.prompt || "").trim(),
      options: (question.options || []).map((item: unknown) => String(item).trim()).filter(Boolean),
      type: question.type === "multiple" ? "multiple" as const : "single" as const,
      answerIndex: Number(question.answerIndex || 0),
      answerIndexes: (question.answerIndexes || []).map(Number),
      explanation: String(question.explanation || ""),
      sortOrder: Number(question.sortOrder || (index + 1) * 10)
    }));
    const previous = state.exams.find((item) => item.id === id);
    upsert(state.exams, {
      id,
      title: String(payload.title || payload.productName || "产品答题").trim(),
      productName: String(payload.productName || "").trim(),
      passScore: Number(payload.passScore || 80),
      goldenBeans: Number(payload.goldenBeans || 0),
      attempts: Number(previous?.attempts || 0),
      passRate: Number(previous?.passRate || 0),
      status: payload.status === "draft" ? "draft" : "published",
      sortOrder: Number(payload.sortOrder || 999),
      groupKey: String(payload.groupKey || ""),
      subExamIndex: Number(payload.subExamIndex || 0),
      totalSubExams: Number(payload.totalSubExams || 0),
      questions
    });
    state.questions = [...state.questions.filter((question) => question.examId !== id), ...questions];
  } else if (action === "deleteLearningContent") {
    const key = payload.contentType === "course" ? "courses" : payload.contentType === "exam" ? "exams" : "phrases";
    (state[key] as Array<{ id: string }>).splice(0, state[key].length, ...state[key].filter((item: { id: string }) => item.id !== payload.contentId) as any);
    if (payload.contentType === "exam") state.questions = state.questions.filter((item) => item.examId !== payload.contentId);
  } else if (action === "saveTaskRewards") {
    state.taskRewards = { pop: Number(payload.pop || 0), phrase: Number(payload.phrase || 0), case: Number(payload.case || 0) };
  } else if (action === "saveProductRewardRule") {
    const id = String(payload.productKey || payload.productName || createId("product-rule"));
    upsert(state.productRewardRules, { id, productKey: id, productName: payload.productName, rewardCap: Number(payload.rewardCap || 0), status: payload.status === "inactive" ? "inactive" : "active" });
  } else if (action === "setUniformProductTask") {
    const productKey = String(payload.productKey || "").trim();
    const periodKey = String(payload.periodKey || "").trim();
    const targetQuantity = Number(payload.targetQuantity || 0);
    if (!productKey) throw new Error("请选择产品");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) throw new Error("统计周期必须是 YYYY-MM");
    if (!Number.isInteger(targetQuantity) || targetQuantity <= 0) throw new Error("任务目标必须是正整数");
    const targets = state.employees.filter((employee) => {
      if (employee.status !== "active" || employee.role === "admin" || employee.role === "supplier") return false;
      const store = state.stores.find((item) => item.id === employee.storeId);
      return Boolean(store && store.status !== "inactive" && store.organizationType !== "department");
    });
    let createdCount = 0;
    let updatedCount = 0;
    targets.forEach((employee) => {
      const existing = state.employeeProductTasks.find((item) => item.employeeId === employee.id && item.productKey === productKey && item.periodKey === periodKey);
      if (existing) {
        existing.targetQuantity = targetQuantity;
        existing.completedQuantity = Math.max(0, Number(existing.completedQuantity || 0));
        existing.attainmentRate = Math.min(100, Math.round(existing.completedQuantity / targetQuantity * 100));
        existing.updatedAt = now;
        existing.source = "admin-uniform-task";
        updatedCount += 1;
      } else {
        const store = state.stores.find((item) => item.id === employee.storeId);
        state.employeeProductTasks.push({ id: createId("task"), employeeId: employee.id, employeeName: employee.name, storeId: employee.storeId, storeName: store?.name || "", productKey, periodKey, targetQuantity, completedQuantity: 0, attainmentRate: 0, source: "admin-uniform-task", updatedAt: now });
        createdCount += 1;
      }
    });
    recalculateDashboard(state);
    persist();
    return { ok: true, productKey, periodKey, targetQuantity, affectedEmployeeCount: targets.length, createdCount, updatedCount, excludedCount: state.employees.length - targets.length };
  } else if (action === "clearUniformProductTask") {
    const productKey = String(payload.productKey || "").trim();
    const periodKey = String(payload.periodKey || "").trim();
    if (!productKey) throw new Error("请选择产品");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) throw new Error("统计周期必须是 YYYY-MM");
    const before = state.employeeProductTasks.length;
    state.employeeProductTasks = state.employeeProductTasks.filter((item) => !(
      String(item.productKey || "").trim() === productKey
      && String(item.periodKey || "").trim() === periodKey
      && String(item.source || "") === "admin-uniform-task"
    ));
    const deletedCount = before - state.employeeProductTasks.length;
    recalculateDashboard(state);
    persist();
    return { ok: true, productKey, periodKey, deletedCount };
  } else if (action === "setUniformStoreProductSalesTarget") {
    const productKey = String(payload.productKey || "").trim();
    const periodKey = String(payload.periodKey || "").trim();
    const targetQuantity = Number(payload.targetQuantity || 0);
    if (!productKey) throw new Error("请选择产品");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) throw new Error("统计周期必须是 YYYY-MM");
    if (!Number.isInteger(targetQuantity) || targetQuantity <= 0) throw new Error("任务目标必须是正整数");
    state.storeProductSales ||= [];
    const eligibleStores = state.stores.filter((store) => store.status !== "inactive" && store.organizationType !== "department");
    let createdCount = 0;
    let updatedCount = 0;
    let preservedCompletedQuantity = 0;
    eligibleStores.forEach((store) => {
      const index = state.storeProductSales.findIndex((item) => item.storeId === store.id && item.productKey === productKey && item.periodKey === periodKey);
      if (index >= 0) {
        const previous = state.storeProductSales[index];
        const completedQuantity = Math.max(0, Math.trunc(Number(previous.completedQuantity || 0)));
        state.storeProductSales[index] = {
          ...previous,
          storeName: organizationDisplayName(store),
          targetQuantity,
          completedQuantity,
          attainmentRate: Math.min(100, Math.round(completedQuantity / targetQuantity * 100)),
          source: "admin-uniform-store-task",
          updatedAt: now
        };
        preservedCompletedQuantity += completedQuantity;
        updatedCount += 1;
      } else {
        state.storeProductSales.push({
          id: `${store.id}-${productKey}-${periodKey}`,
          storeId: store.id,
          storeName: organizationDisplayName(store),
          productKey,
          periodKey,
          targetQuantity,
          completedQuantity: 0,
          attainmentRate: 0,
          source: "admin-uniform-store-task",
          createdAt: now,
          updatedAt: now
        });
        createdCount += 1;
      }
    });
    persist();
    return {
      ok: true,
      productKey,
      periodKey,
      targetQuantity,
      affectedStoreCount: eligibleStores.length,
      createdCount,
      updatedCount,
      excludedStoreCount: state.stores.length - eligibleStores.length,
      preservedCompletedQuantity
    };
  } else if (action === "importStoreProductSales") {
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    state.storeProductSales ||= [];
    const imported: any[] = [];
    const rejected: Array<{ row: number; message: string }> = [];
    rows.forEach((row: any, index: number) => {
      const rowNumber = Number.isInteger(Number(row.rowNumber)) && Number(row.rowNumber) > 0 ? Number(row.rowNumber) : index + 2;
      try {
        const storeName = String(row.storeName || row.store || "").trim();
        const eligibleStores = state.stores.filter((store) => store.status !== "inactive" && store.organizationType !== "department");
        const store = exactOrganizationMatch(eligibleStores, storeName);
        const shortMatches = eligibleStores.filter((item) => item.name === storeName);
        if (!store) throw new Error(shortMatches.length > 1 ? "匹配到多个同名门店，请填写品牌抬头和分店名" : "未找到启用的实体门店");
        const productKey = String(row.productKey || row.product || "").trim();
        const periodKey = String(row.periodKey || row.period || "").trim();
        const targetQuantity = Number(row.targetQuantity || row.target || 0);
        const rateRaw = row.attainmentRate ?? row.rate;
        const completedQuantity = row.completedQuantity !== undefined && String(row.completedQuantity).trim() !== ""
          ? Number(row.completedQuantity)
          : Math.round(targetQuantity * Number(String(rateRaw || 0).replace(/%$/, "")) / 100);
        if (!productKey) throw new Error("产品不能为空");
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) throw new Error("统计周期必须是 YYYY-MM");
        if (!Number.isInteger(targetQuantity) || targetQuantity <= 0) throw new Error("任务目标必须是正整数");
        if (!Number.isInteger(completedQuantity) || completedQuantity < 0) throw new Error("完成数量必须是非负整数");
        const record = {
          id: `${store.id}-${productKey}-${periodKey}`,
          storeId: store.id,
          storeName: organizationDisplayName(store),
          productKey,
          periodKey,
          targetQuantity,
          completedQuantity,
          attainmentRate: Math.min(100, Math.round(completedQuantity / targetQuantity * 100)),
          source: "admin-import",
          updatedAt: now
        };
        const existingIndex = state.storeProductSales.findIndex((item) => item.storeId === store.id && item.productKey === productKey && item.periodKey === periodKey);
        if (existingIndex >= 0) state.storeProductSales[existingIndex] = { ...state.storeProductSales[existingIndex], ...record };
        else state.storeProductSales.push(record);
        imported.push({ row: rowNumber, ...record });
      } catch (error) {
        rejected.push({ row: rowNumber, message: error instanceof Error ? error.message : "导入失败" });
      }
    });
    persist();
    return { ok: true, importedCount: imported.length, rejectedCount: rejected.length, imported, rejected };
  } else if (action === "clearStoreProductSales") {
    const productKey = String(payload.productKey || "").trim();
    const periodKey = String(payload.periodKey || "").trim();
    const before = state.storeProductSales?.length || 0;
    state.storeProductSales = (state.storeProductSales || []).filter((item) => !(item.productKey === productKey && item.periodKey === periodKey));
    const deletedCount = before - state.storeProductSales.length;
    persist();
    return { ok: true, productKey, periodKey, deletedCount };
  } else if (action === "saveStoreTaskReward") {
    const productKey = String(payload.productKey || "").trim();
    if (!productKey) throw new Error("请选择产品");
    const id = `demo-store-task-reward-${productKey}`;
    upsert(state.storeTaskRewards, {
      id,
      productKey,
      title: String(payload.title || `${productKey} 1盒`).trim(),
      description: String(payload.description || "完成门店销售任务后可领取").trim(),
      itemValue: Math.max(0, Number(payload.itemValue || 0)),
      threshold: 10,
      status: payload.status === "inactive" ? "inactive" : "active",
      updatedAt: now
    });
  } else if (action === "saveReward") {
    if (payload.nonDrugConfirmed !== true) throw new Error("请确认该礼品不是药品或医疗器械");
    const id = payload.rewardId || createId("reward");
    const imageValue = String(payload.imageUrl || "");
    const localImageId = imageValue.startsWith(demoMediaPrefix)
      ? imageValue
      : [...objectUrls.entries()].find(([, url]) => url === imageValue)?.[0] || "";
    upsert(state.rewards, {
      id,
      title: String(payload.title || "").trim(),
      description: String(payload.description || "").trim(),
      goldenBeanPrice: Number(payload.goldenBeanPrice || 0),
      stock: Number(payload.stock || 0),
      status: payload.status === "inactive" ? "inactive" : "active",
      imageFileId: localImageId,
      imageUrl: localImageId ? "" : imageValue,
      sortOrder: Number(payload.sortOrder || 999),
      nonDrugConfirmed: true,
      nonDrugConfirmedAt: now,
      nonDrugConfirmedBy: "web-admin"
    });
  } else if (action === "saveCase") {
    if (payload.casePrivacyConfirmed !== true || payload.casePrivacyVersion !== "case-deidentification-2026-07-30") throw new Error("请完成顾客隐私检查");
    const id = payload.caseId || createId("case");
    upsert(state.submissions, {
      id,
      type: "case",
      title: String(payload.title || "案例资料").trim(),
      content: String(payload.content || "").trim(),
      employeeId: payload.publisherEmployeeId || state.employees.find((item) => item.role === "admin")?.id || "",
      storeId: state.employees.find((item) => item.id === payload.publisherEmployeeId)?.storeId || "",
      publisherName: "学习运营台",
      publisherRole: "admin",
      createdAt: now,
      status: "approved",
      goldenBeans: 0,
      images: payload.images || [],
      videoFileId: payload.videoFileId || "",
      videoUrl: payload.videoUrl || "",
      casePrivacyConfirmed: true,
      casePrivacyVersion: payload.casePrivacyVersion,
      acknowledgementRequired: payload.acknowledgementRequired === true,
      productName: String(payload.productName || "").trim(),
      visibleSupplierIds: Array.isArray(payload.visibleSupplierIds) ? payload.visibleSupplierIds.map(String) : []
    });
  } else if (action === "reviewEmployeeApplication") {
    const application = state.employeeApplications.find((item) => item.id === payload.applicationId);
    if (!application) throw new Error("员工申请不存在");
    if (application.status !== "pending") return { ok: true, alreadyReviewed: true };
    if (payload.decision === "rejected" && !String(payload.rejectionReason || "").trim()) throw new Error("请填写拒绝原因");
    if (payload.decision === "approved") {
      const employeeId = `demo-approved-${application.id}`;
      const store = state.stores.find((item) => item.id === application.storeId);
      upsert(state.employees, {
        id: employeeId,
        name: application.employeeName,
        employeeNo: `WX-DEMO-${state.employees.length + 1}`,
        role: "employee",
        storeId: application.storeId,
        regionId: store?.regionId || "shenzhen",
        goldenBeans: 0,
        courseCompletionRate: 0,
        examPassRate: 0,
        status: "active",
        wechatNickname: application.wechatNickname,
        wechatAvatarUrl: application.wechatAvatarUrl
      });
      Object.assign(application, { status: "approved", employeeId, reviewedAt: now, reviewedBy: "web-admin", rejectionReason: "" });
    } else {
      Object.assign(application, { status: "rejected", reviewedAt: now, reviewedBy: "web-admin", rejectionReason: String(payload.rejectionReason || "").trim() });
    }
  } else if (action === "unbindEmployeeWechat") {
    const employee = state.employees.find((item) => item.id === payload.employeeId);
    const previousBindingCount = Number(employee?.wechatBindingCount || (employee?.wechatBound ? 1 : 0));
    if (employee) {
      employee.wechatBound = false;
      employee.wechatBindingCount = 0;
      employee.wechatNickname = "";
      employee.wechatAvatarUrl = "";
    }
    recalculateDashboard(state);
    persist();
    return { ok: true, employeeId: payload.employeeId, unboundCount: previousBindingCount, invalidatedSessionCount: 0 };
  } else if (action === "resetEmployeeGoldenBeans") {
    if (payload.confirmation !== "确认清零") throw new Error("请输入“确认清零”后再执行");
    const activeEmployees = state.employees.filter((employee) => employee.status !== "inactive" && employee.role !== "supplier");
    activeEmployees.forEach((employee) => { employee.goldenBeans = 0; });
    recalculateDashboard(state);
    persist();
    return { ok: true, employeeCount: activeEmployees.length, resetLedgerCount: activeEmployees.length };
  } else if (action === "resetEmployeeLearningProgress") {
    if (payload.confirmation !== "确认清零") throw new Error("请输入“确认清零”后再执行");
    const activeIds = new Set(state.employees.filter((employee) => employee.status !== "inactive" && employee.role !== "supplier").map((employee) => employee.id));
    const countFor = (items: Array<{ employeeId?: string }>) => items.filter((item) => activeIds.has(String(item.employeeId || ""))).length;
    const deletedCourseProgress = countFor(state.courseProgress);
    const deletedProductTasks = countFor(state.employeeProductTasks);
    const deletedExamAttempts = countFor(state.examAttempts);
    const deletedPhraseAttempts = countFor(state.phrasePracticeAttempts);
    state.courseProgress = state.courseProgress.filter((item) => !activeIds.has(String(item.employeeId || "")));
    state.employeeProductTasks = state.employeeProductTasks.filter((item) => !activeIds.has(String(item.employeeId || "")));
    state.examAttempts = state.examAttempts.filter((item) => !activeIds.has(String(item.employeeId || "")));
    state.phrasePracticeAttempts = state.phrasePracticeAttempts.filter((item) => !activeIds.has(String(item.employeeId || "")));
    state.employees.filter((employee) => activeIds.has(employee.id)).forEach((employee) => { employee.courseCompletionRate = 0; employee.examPassRate = 0; });
    recalculateDashboard(state);
    persist();
    return { ok: true, employeeCount: activeIds.size, deletedCourseProgress, deletedProductTasks, deletedExamAttempts, deletedPhraseAttempts };
  } else if (action === "deleteCasePost") {
    state.submissions = state.submissions.filter((item) => item.id !== payload.caseId);
  } else if (action === "reviewSubmission") {
    const submission = state.submissions.find((item) => item.id === payload.submissionId);
    if (submission?.type === "case" && payload.decision === "approved" && (
      payload.casePrivacyConfirmed !== true || payload.casePrivacyVersion !== "case-deidentification-2026-07-30"
    )) throw new Error("请完成顾客隐私检查");
    state.submissions = state.submissions.map((item) => item.id === payload.submissionId ? { ...item, status: payload.decision === "approved" ? "approved" : "rejected", rejectReason: payload.rejectReason || "" } : item);
  } else if (action === "adjustGoldenBeans") {
    const employee = state.employees.find((item) => item.id === payload.employeeId);
    const delta = Number(payload.delta || 0);
    if (employee) employee.goldenBeans = Math.max(0, employee.goldenBeans + delta);
    state.goldenBeanLedger.unshift({ id: createId("ledger"), employeeId: payload.employeeId, source: "admin", delta, reason: String(payload.reason || "后台调整"), createdAt: now });
  } else if (action === "fulfillRedemption") {
    state.redemptions = state.redemptions.map((item) => item.id === payload.redemptionId ? { ...item, status: "fulfilled", fulfilledAt: now, fulfillRemark: payload.fulfillRemark || "" } : item);
  }

  recalculateDashboard(state);
  recalculateSupplierViews(state);
  persist();
  return { ok: true };
}

export async function uploadAdminDemoAsset(file: File, folder: string) {
  if (!window.indexedDB) throw new Error("当前浏览器不支持本地素材上传");
  const id = `${demoMediaPrefix}${createId(folder.replace(/[^a-z0-9]+/gi, "-") || "asset")}`;
  const database = await openMediaDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(mediaStoreName, "readwrite");
    transaction.objectStore(mediaStoreName).put({ id, blob: file, name: file.name, contentType: file.type, size: file.size, createdAt: new Date().toISOString() });
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => reject(transaction.error || new Error("本地素材保存失败"));
  });
  const url = URL.createObjectURL(file);
  objectUrls.set(id, url);
  return { fileID: id, url, cloudPath: id, size: file.size, contentType: file.type };
}
