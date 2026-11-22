const { createServer } = require("node:http");
const { createHash } = require("node:crypto");
const COS = require("cos-nodejs-sdk-v5");
const {
  addCappedGoldenBeans,
  addGoldenBeansOnce,
  app,
  command,
  db,
  fail,
  getFirst,
  now,
  ok
} = require("./_shared/db");
const {
  nonNegativeInteger,
  positiveInteger,
  requireNonNegativeInteger
} = require("./_shared/rewardRules");
const {
  assertAdminSecret,
  bearerSecret
} = require("./authCore");
const { learningMetricsForEmployee } = require("./_shared/learningMetrics");
const {
  acknowledgementRecipientRecords
} = require("./_shared/caseAcknowledgements");
const {
  CASE_PRIVACY_VERSION,
  assertAdminCasePrivacyConfirmation,
  assertNonDrugRewardConfirmation,
  publicEmployeeApplication,
  recordingRetentionExpiry,
  reviewEmployeeApplication
} = require("./employeeApplicationCore");
const { buildEmployeeImportPlan } = require("./employeeImportCore");
const {
  buildLegacyDuplicateEmployeeCleanupPlan,
  findRelationCollisions,
  sameEmployeeIdSet
} = require("./legacyDuplicateEmployeeCleanupCore");
const {
  currentPeriodKey,
  nonNegativeInteger: taskCompletedQuantity,
  positiveInteger: taskTargetQuantity
} = require("./_shared/productTasks");
const { isNormalStoreEmployee, mergeUniformTask } = require("./_shared/uniformProductTaskCore");
const { isNormalStoreStaff } = require("./_shared/supplierAccess");
const {
  normalizeStoreProductSaleRow,
  storeProductSalesBusinessKey,
  prepareStoreProductSaleUpsert,
  prepareUniformStoreProductSales,
  storeProductSalesImportRowNumber
} = require("./storeProductSalesCore");
const {
  findSupplierOrganization,
  invalidSupplierProducts,
  isEmployeeResetTarget,
  supplierOrganizationRecord
} = require("./supplierAdminCore");
const {
  buildCloudFileId,
  buildOutputPrefix,
  parseCloudFileId,
  parseCosLocation,
  parseCreatedJob,
  parseJobResult,
  sortedSlideKeys
} = require("./pptConversionCore");

const collections = {
  users: "users",
  webSessions: "webSessions",
  auditLogs: "auditLogs",
  webMediaUploads: "webMediaUploads",
  employees: "employees",
  employeeApplications: "employeeApplications",
  brands: "brands",
  stores: "stores",
  courses: "courses",
  phrases: "phrases",
  exams: "exams",
  questions: "questions",
  popSubmissions: "popSubmissions",
  phraseSubmissions: "phraseSubmissions",
  cases: "cases",
  caseAcknowledgements: "caseAcknowledgements",
  caseComments: "caseComments",
  caseLikes: "caseLikes",
  goldenBeanLedger: "goldenBeanLedger",
  rewards: "rewards",
  redemptions: "redemptions",
  taskRewards: "taskRewards",
  productRewardRules: "productRewardRules",
  employeeProductTasks: "employeeProductTasks",
  storeProductSales: "storeProductSales",
  storeTaskRewards: "storeTaskRewards",
  storeReceipts: "storeReceipts",
  courseProgress: "courseProgress",
  examAttempts: "examAttempts",
  phrasePracticeAttempts: "phrasePracticeAttempts",
  pptConversionJobs: "pptConversionJobs"
};

const collectionByType = {
  pop: "popSubmissions",
  phrase: "phraseSubmissions",
  case: "cases"
};

const reviewSecret = process.env.ADMIN_REVIEW_SECRET || "";
const maxUploadBytes = 80 * 1024 * 1024;
const chronicCategories = ["diabetes", "hypertension", "hyperuricemia", "hyperlipidemia"];
const defaultTaskRewards = {
  pop: 0,
  phrase: 0,
  case: 0
};
const legacyEmployeeRelationCollections = [
  collections.employeeApplications,
  collections.courseProgress,
  collections.goldenBeanLedger,
  collections.redemptions,
  collections.examAttempts,
  collections.phrasePracticeAttempts,
  collections.employeeProductTasks,
  collections.popSubmissions,
  collections.phraseSubmissions,
  collections.cases,
  collections.caseComments,
  collections.caseLikes,
  collections.webMediaUploads
];
const legacyCleanupConfirmation = "DELETE_ZERO_BALANCE_LEGACY_DUPLICATES";

function normalizeId(item = {}) {
  const { _id, ...rest } = item;
  return {
    ...rest,
    id: item.id || _id
  };
}

function normalizeSubmission(item = {}) {
  return {
    ...normalizeId(item),
    status: item.status || "pending",
    goldenBeans: Number(item.goldenBeans ?? 0)
  };
}

function normalizeCaseImages(item = {}) {
  const images = Array.isArray(item.images) ? item.images : [];
  const normalizedImages = images
    .map((image) => ({
      fileId: optionalString(image?.fileId || image?.fileID),
      imageUrl: optionalString(image?.imageUrl || image?.url),
      width: Number(image?.width || 0),
      height: Number(image?.height || 0),
      size: Number(image?.size || 0)
    }))
    .filter((image) => image.fileId || image.imageUrl);

  if (normalizedImages.length > 0) {
    return normalizedImages.slice(0, 9);
  }

  const fileId = optionalString(item.fileId);
  const imageUrl = optionalString(item.imageUrl);
  return fileId || imageUrl ? [{ fileId, imageUrl, width: 0, height: 0, size: 0 }] : [];
}

function buildTaskRewards(records = []) {
  return records.reduce((next, item) => ({
    ...next,
    [item._id || item.id]: nonNegativeInteger(
      item.goldenBeans,
      defaultTaskRewards[item._id || item.id] ?? 0
    )
  }), { ...defaultTaskRewards });
}

async function getCollection(collectionName, limit = 1000) {
  const result = await db.collection(collectionName).limit(limit).get();
  return result.data || [];
}

async function getOptionalCollectionRecords(collectionName, limit = 1000) {
  try {
    return await getCollection(collectionName, limit);
  } catch (error) {
    if (isMissingCollectionError(error)) return [];
    throw error;
  }
}

function isMissingCollectionError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return code === "DATABASE_COLLECTION_NOT_EXIST" || /db or table not exist|collection not exist|table not exist|not found/i.test(message);
}

function buildDashboardStats({ employees, employeeApplications = [], submissions, goldenBeanLedger }) {
  const staff = employees.filter((employee) => employee.role !== "supplier");
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
    pendingReviews: submissions.filter((item) => item.status === "pending").length,
    pendingEmployeeApplications: employeeApplications.filter((item) => item.status === "pending").length,
    issuedGoldenBeans: goldenBeanLedger
      .filter((item) => Number(item.delta) > 0)
      .reduce((sum, item) => sum + Number(item.delta || 0), 0)
  };
}

function buildSupplierViews({ employees, stores, courses, phrases, exams, courseProgress, phrasePracticeAttempts, goldenBeanLedger, examAttempts, employeeProductTasks }) {
  const storeName = (storeId) => stores.find((store) => String(store.id || store._id) === String(storeId))?.name || "";
  const staff = employees.filter((employee) => isNormalStoreStaff(employee, stores));
  const productOf = (item = {}) => String(item.productKey || item.productId || item.productName || item.title || "").trim();
  const idOf = (item = {}) => String(item.id || item._id || "");
  const average = (values = []) => values.length ? Math.round(values.reduce((sum, value) => sum + Math.max(0, Math.min(100, Number(value) || 0)), 0) / values.length) : 0;

  return employees.filter((employee) => employee.status === "active" && employee.role === "supplier").map((supplier) => {
    const productKeys = Array.isArray(supplier.supplierProductKeys)
      ? supplier.supplierProductKeys.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const products = productKeys.map((productKey) => {
      const productCourses = courses.filter((item) => productOf(item) === productKey);
      const productPhrases = phrases.filter((item) => productOf(item) === productKey);
      const productExams = exams.filter((item) => productOf(item) === productKey);
      const productEmployees = staff.map((employee) => {
        const metrics = learningMetricsForEmployee({
          employeeId: employee.id || employee._id,
          courses: productCourses,
          courseProgress,
          phrases: productPhrases,
          phrasePracticeAttempts,
          goldenBeanLedger,
          exams: productExams,
          examAttempts,
          employeeProductTasks,
          productTaskPeriodKey: currentPeriodKey()
        });
        return {
          ...employee,
          store: storeName(employee.storeId),
          completionRate: metrics.courseCompletionRate,
          contentCompletionRate: metrics.contentCompletionRate,
          examPassRate: metrics.examPassRate
        };
      });
      return {
        productKey,
        productName: productKey,
        averageCompletionRate: average(productEmployees.map((employee) => employee.completionRate)),
        employees: productEmployees
      };
    });
    return {
      supplierId: idOf(supplier),
      supplierName: supplier.name,
      supplierLabel: supplier.supplierName || "未填写厂家",
      wechatBound: Boolean(supplier.wechatBound),
      wechatNickname: supplier.wechatNickname || "",
      productKeys,
      products
    };
  });
}

function normalizeEmployeeApplication(item = {}) {
  return publicEmployeeApplication(item);
}

async function importEmployeeProductTasks(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) return secretError;
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length) return fail("请先选择任务数据", "PRODUCT_TASK_ROWS_REQUIRED");
  const [employees, stores] = await Promise.all([getCollection(collections.employees, 1000), getCollection(collections.stores, 1000)]);
  const imported = [];
  const rejected = [];
  for (let index = 0; index < rows.length; index += 1) {
    try {
      const task = normalizeProductTaskRow(rows[index], employees, stores);
      const result = await db.collection(collections.employeeProductTasks).where({ employeeId: task.employeeId, productKey: task.productKey, periodKey: task.periodKey }).limit(1).get().catch(async (error) => {
        if (!isMissingCollectionError(error)) throw error;
        await db.createCollection(collections.employeeProductTasks);
        return { data: [] };
      });
      const existing = result.data?.[0];
      const record = { ...task, source: "admin-import", updatedBy: "headquarters-admin", updatedAt: now() };
      if (existing) await db.collection(collections.employeeProductTasks).doc(existing._id).update(record);
      else await db.collection(collections.employeeProductTasks).add({ ...record, createdAt: now() });
      imported.push({ row: index + 1, ...task });
    } catch (error) {
      rejected.push({ row: index + 1, message: error.message || "导入失败" });
    }
  }
  return ok({ importedCount: imported.length, rejectedCount: rejected.length, imported, rejected });
}

async function importStoreProductSales(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) return secretError;
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length) return fail("请先选择门店销售数据", "STORE_SALES_ROWS_REQUIRED");

  const stores = await getCollection(collections.stores, 1000);
  const existing = await getOptionalCollectionRecords(collections.storeProductSales, 5000);
  const existingByKey = new Map(existing.map((item) => [storeProductSalesBusinessKey(item), item]));
  const imported = [];
  const rejected = [];
  const updatedAt = now();
  let collectionReady = existing.length > 0;

  for (let index = 0; index < rows.length; index += 1) {
    try {
      const sale = normalizeStoreProductSaleRow(rows[index], stores, updatedAt);
      const rowNumber = storeProductSalesImportRowNumber(rows[index], index);
      const { key, previous, record } = prepareStoreProductSaleUpsert(sale, existingByKey, updatedAt);
      if (!collectionReady) {
        try {
          await db.createCollection(collections.storeProductSales);
        } catch (error) {
          const code = String(error?.code || "");
          const message = String(error?.message || "");
          if (!/EXIST/i.test(code) && !/already exists|collection exists/i.test(message)) throw error;
        }
        collectionReady = true;
      }
      if (previous?._id) {
        const { _id, ...document } = record;
        await db.collection(collections.storeProductSales).doc(previous._id).update(document);
      }
      else {
        const result = await db.collection(collections.storeProductSales).add(record);
        record._id = result.id;
      }
      existingByKey.set(key, record);
      imported.push({ row: rowNumber, ...sale });
    } catch (error) {
      rejected.push({ row: storeProductSalesImportRowNumber(rows[index], index), message: error.message || "导入失败" });
    }
  }
  return ok({ importedCount: imported.length, rejectedCount: rejected.length, imported, rejected });
}

async function clearStoreProductSales(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) return secretError;
  const productKey = optionalString(payload.productKey || payload.product || payload.productName);
  if (!productKey) return fail("请选择产品", "STORE_SALES_PRODUCT_REQUIRED");
  const periodKey = normalizePeriodKey(payload.periodKey || payload.period);
  const records = await getOptionalCollectionRecords(collections.storeProductSales, 5000);
  const matching = records.filter((item) => (
    String(item.productKey || "").trim() === productKey
    && String(item.periodKey || "").trim() === periodKey
  ));
  await Promise.all(matching.filter((item) => item._id).map((item) => db.collection(collections.storeProductSales).doc(item._id).remove()));
  return ok({ productKey, periodKey, deletedCount: matching.filter((item) => item._id).length });
}

async function ensureAdminCollection(collectionName) {
  try {
    await db.createCollection(collectionName);
  } catch (error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    if (!/EXIST/i.test(code) && !/already exists|collection exists/i.test(message)) throw error;
  }
}

async function setUniformStoreProductSalesTarget(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) return secretError;
  const productKey = optionalString(payload.productKey || payload.product || payload.productName);
  if (!productKey) return fail("请选择产品", "STORE_SALES_PRODUCT_REQUIRED");
  const periodKey = normalizePeriodKey(payload.periodKey || payload.period);
  const targetQuantity = taskTargetQuantity(payload.targetQuantity ?? payload.target);
  if (!targetQuantity) return fail("任务目标必须是正整数", "STORE_SALES_TARGET_INVALID");

  const [stores, existing] = await Promise.all([
    getCollection(collections.stores, 1000),
    getOptionalCollectionRecords(collections.storeProductSales, 5000)
  ]);
  const prepared = prepareUniformStoreProductSales({
    stores,
    existing,
    productKey,
    periodKey,
    targetQuantity,
    timestamp: now()
  });
  await ensureAdminCollection(collections.storeProductSales);

  for (const record of prepared.records) {
    if (record._id) {
      const { _id, ...document } = record;
      await db.collection(collections.storeProductSales).doc(_id).update(document);
    } else {
      await db.collection(collections.storeProductSales).add(record);
    }
  }
  return ok({
    productKey: prepared.productKey,
    periodKey: prepared.periodKey,
    targetQuantity: prepared.targetQuantity,
    affectedStoreCount: prepared.affectedStoreCount,
    createdCount: prepared.createdCount,
    updatedCount: prepared.updatedCount,
    excludedStoreCount: prepared.excludedStoreCount,
    preservedCompletedQuantity: prepared.preservedCompletedQuantity
  });
}

async function saveStoreTaskReward(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) return secretError;
  const productKey = optionalString(payload.productKey || payload.productName);
  if (!productKey) return fail("请选择产品", "STORE_TASK_REWARD_PRODUCT_REQUIRED");
  const title = optionalString(payload.title) || `${productKey} 1盒`;
  const description = optionalString(payload.description) || "完成门店销售任务后可领取";
  const itemValue = Number(payload.itemValue ?? payload.value ?? 0);
  if (!Number.isFinite(itemValue) || itemValue < 0) return fail("商品价值必须是非负金额", "STORE_TASK_REWARD_VALUE_INVALID");
  const rewardId = `store-task-reward-${createHash("sha256").update(productKey).digest("hex").slice(0, 24)}`;
  const createdAt = now();
  const reward = {
    productKey,
    title,
    description,
    itemValue,
    threshold: 10,
    status: payload.status === "inactive" ? "inactive" : "active",
    updatedAt: createdAt
  };
  const existing = (await getOptionalCollectionRecords(collections.storeTaskRewards, 1000))
    .find((item) => String(item._id || item.id || "") === rewardId) || null;
  await ensureAdminCollection(collections.storeTaskRewards);
  if (existing) {
    await db.collection(collections.storeTaskRewards).doc(rewardId).update(reward);
  } else {
    await db.collection(collections.storeTaskRewards).doc(rewardId).set({ ...reward, createdAt });
  }
  return ok({ storeTaskReward: { id: rewardId, ...reward, createdAt: existing?.createdAt || createdAt } });
}

async function setUniformProductTask(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) return secretError;
  const productKey = optionalString(payload.productKey || payload.product || payload.productName);
  if (!productKey) return fail("请选择产品", "PRODUCT_TASK_PRODUCT_REQUIRED");
  const periodKey = normalizePeriodKey(payload.periodKey || payload.period);
  const targetQuantity = taskTargetQuantity(payload.targetQuantity ?? payload.target);
  if (!targetQuantity) return fail("任务目标必须是正整数", "PRODUCT_TASK_TARGET_INVALID");
  const [employees, stores] = await Promise.all([
    getCollection(collections.employees, 1000),
    getCollection(collections.stores, 1000)
  ]);
  const targets = employees.filter((employee) => isNormalStoreEmployee(employee, stores));
  const result = await db.collection(collections.employeeProductTasks).limit(5000).get().catch(async (error) => {
    if (!isMissingCollectionError(error)) throw error;
    await db.createCollection(collections.employeeProductTasks);
    return { data: [] };
  });
  const existingByEmployee = new Map((result.data || [])
    .filter((item) => String(item.productKey || "").trim() === productKey && String(item.periodKey || "").trim() === periodKey)
    .map((item) => [String(item.employeeId || ""), item]));
  let createdCount = 0;
  let updatedCount = 0;
  const updatedAt = now();
  for (const employee of targets) {
    const employeeId = employee._id || employee.id;
    const existing = existingByEmployee.get(String(employeeId));
    const record = mergeUniformTask({ employee, store: stores.find((item) => String(item._id || item.id) === String(employee.storeId || "")), existing, productKey, periodKey, targetQuantity, timestamp: updatedAt });
    if (existing?._id) {
      await db.collection(collections.employeeProductTasks).doc(existing._id).update(record);
      updatedCount += 1;
    } else {
      await db.collection(collections.employeeProductTasks).add({ ...record, createdAt: updatedAt });
      createdCount += 1;
    }
  }
  return ok({
    productKey,
    periodKey,
    targetQuantity,
    affectedEmployeeCount: targets.length,
    createdCount,
    updatedCount,
    excludedCount: employees.length - targets.length
  });
}

async function clearUniformProductTask(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) return secretError;
  const productKey = optionalString(payload.productKey || payload.product || payload.productName);
  if (!productKey) return fail("请选择产品", "PRODUCT_TASK_PRODUCT_REQUIRED");
  const periodKey = normalizePeriodKey(payload.periodKey || payload.period);
  const result = await db.collection(collections.employeeProductTasks).where({
    productKey,
    periodKey,
    source: "admin-uniform-task"
  }).limit(5000).get().catch(async (error) => {
    if (!isMissingCollectionError(error)) throw error;
    await db.createCollection(collections.employeeProductTasks);
    return { data: [] };
  });
  let deletedCount = 0;
  for (const item of result.data || []) {
    if (!item._id) continue;
    await db.collection(collections.employeeProductTasks).doc(item._id).remove();
    deletedCount += 1;
  }
  return ok({ productKey, periodKey, deletedCount });
}

async function enforceNinetyPointExamRule(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) return secretError;
  const [exams, attempts] = await Promise.all([
    getCollection(collections.exams, 1000),
    getCollection(collections.examAttempts, 5000).catch(() => [])
  ]);
  await Promise.all(exams.map((exam) => db.collection(collections.exams).doc(exam._id).update({ passScore: 90, updatedAt: now() })));
  const oldPasses = attempts.filter((attempt) => Number(attempt.score || 0) < 90 && attempt.passed !== false);
  await Promise.all(oldPasses.map((attempt) => db.collection(collections.examAttempts).doc(attempt._id).update({ passed: false, ruleVersion: "pass-score-90", updatedAt: now() })));
  return ok({ updatedExams: exams.length, resetAttempts: oldPasses.length, passScore: 90 });
}

function userIdForOpenId(openId) {
  return `user-${createHash("sha256").update(String(openId || "")).digest("hex").slice(0, 20)}`;
}

function sendJson(req, res, body, statusCode = 200) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Accept, Authorization",
    "access-control-max-age": "86400",
    vary: "Origin"
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function readBuffer(req, maxBytes = maxUploadBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("上传文件不能超过 80MB"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function parseContentDisposition(headerValue = "") {
  const result = {};
  for (const segment of headerValue.split(";")) {
    const [rawKey, ...rawValue] = segment.trim().split("=");
    const key = rawKey.trim().toLowerCase();
    if (!key || rawValue.length === 0) {
      continue;
    }
    result[key] = rawValue.join("=").trim().replace(/^"|"$/g, "");
  }
  return result;
}

function parseMultipartBuffer(buffer, contentType = "") {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundaryMatch) {
    throw new Error("缺少上传边界信息");
  }

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const headerSeparator = Buffer.from("\r\n\r\n");
  const payload = {};

  let boundaryStart = buffer.indexOf(boundary);
  while (boundaryStart !== -1) {
    let partStart = boundaryStart + boundary.length;
    if (buffer[partStart] === 45 && buffer[partStart + 1] === 45) {
      break;
    }
    if (buffer[partStart] === 13 && buffer[partStart + 1] === 10) {
      partStart += 2;
    }

    const nextBoundary = buffer.indexOf(boundary, partStart);
    if (nextBoundary === -1) {
      break;
    }

    let partEnd = nextBoundary;
    if (buffer[partEnd - 2] === 13 && buffer[partEnd - 1] === 10) {
      partEnd -= 2;
    }

    const headerEnd = buffer.indexOf(headerSeparator, partStart);
    if (headerEnd !== -1 && headerEnd < partEnd) {
      const headerText = buffer.slice(partStart, headerEnd).toString("utf8");
      const headers = {};
      for (const line of headerText.split("\r\n")) {
        const separatorIndex = line.indexOf(":");
        if (separatorIndex === -1) {
          continue;
        }
        const key = line.slice(0, separatorIndex).trim().toLowerCase();
        const value = line.slice(separatorIndex + 1).trim();
        headers[key] = value;
      }

      const disposition = parseContentDisposition(headers["content-disposition"]);
      const content = buffer.slice(headerEnd + headerSeparator.length, partEnd);
      if (disposition.name) {
        if (disposition.filename) {
          payload[disposition.name] = {
            filename: disposition.filename,
            contentType: headers["content-type"] || "application/octet-stream",
            content
          };
        } else {
          payload[disposition.name] = content.toString("utf8");
        }
      }
    }

    boundaryStart = nextBoundary;
  }

  return payload;
}

async function readPayload(req) {
  const contentType = req.headers["content-type"] || "";
  if (/multipart\/form-data/i.test(contentType)) {
    return parseMultipartBuffer(await readBuffer(req), contentType);
  }

  return readJson(req);
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function optionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedEmployeeName(value) {
  return optionalString(value).toLowerCase();
}

function boundedPercentage(value, fieldName) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new Error(`${fieldName}必须是 0-100 的数字`);
  }
  return Math.round(number);
}

function normalizePeriodKey(value) {
  const periodKey = optionalString(value) || currentPeriodKey();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) throw new Error("统计周期必须是 YYYY-MM，例如 2026-08");
  return periodKey;
}

function normalizeProductTaskRow(row, employees, stores) {
  const name = optionalString(row.name || row.employeeName);
  const storeName = optionalString(row.storeName || row.store);
  const matches = employees.filter((employee) => employee.status === "active" && optionalString(employee.name) === name && (!storeName || optionalString(stores.find((store) => String(store._id || store.id) === String(employee.storeId))?.name) === storeName));
  if (matches.length !== 1) throw new Error(matches.length ? "匹配到多个同名员工，请填写门店" : "未找到匹配员工");
  const targetRaw = row.targetQuantity ?? row.target;
  const completedRaw = row.completedQuantity ?? row.completed;
  const targetQuantity = taskTargetQuantity(targetRaw);
  if (!targetQuantity) throw new Error("任务目标必须是正整数");
  const rateRaw = row.attainmentRate ?? row.completionRate ?? row.rate;
  const hasCompleted = completedRaw !== undefined && completedRaw !== null && String(completedRaw).trim() !== "";
  const hasRate = rateRaw !== undefined && rateRaw !== null && String(rateRaw).trim() !== "";
  if (!hasCompleted && !hasRate) throw new Error("请填写完成数量或达成率");
  let completedQuantity;
  let attainmentRate = 0;
  if (hasCompleted) {
    if (!Number.isInteger(Number(completedRaw)) || Number(completedRaw) < 0) throw new Error("完成数量必须是非负整数");
    completedQuantity = taskCompletedQuantity(completedRaw);
    attainmentRate = Math.min(100, Math.round(completedQuantity / targetQuantity * 100));
  } else {
    attainmentRate = Number(String(rateRaw).replace(/%$/, "").trim());
    if (!Number.isFinite(attainmentRate) || attainmentRate < 0 || attainmentRate > 100) throw new Error("达成率必须是 0-100 的数字");
    completedQuantity = Math.round(targetQuantity * attainmentRate / 100);
  }
  const employee = matches[0];
  const store = stores.find((item) => String(item._id || item.id) === String(employee.storeId));
  const productKey = optionalString(row.productKey || row.product || row.productName);
  if (!productKey) throw new Error("产品不能为空");
  return { employeeId: employee._id || employee.id, employeeName: employee.name, storeId: employee.storeId, storeName: store?.name || "", productKey, periodKey: normalizePeriodKey(row.periodKey || row.period), targetQuantity, completedQuantity, attainmentRate };
}

function requireAdminSecret(secret) {
  try {
    assertAdminSecret({ configuredSecret: reviewSecret, providedSecret: secret });
  } catch (error) {
    return fail(error.message, error.code || "ADMIN_UNAUTHORIZED");
  }
  return null;
}

function extensionFromFile(file = {}) {
  const filenameMatch = /\.([a-zA-Z0-9]+)$/.exec(file.filename || "");
  if (filenameMatch) {
    return filenameMatch[1].toLowerCase();
  }

  const contentType = String(file.contentType || "").toLowerCase();
  if (contentType.includes("jpeg")) return "jpg";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  if (contentType.startsWith("audio/") && contentType.includes("mp4")) return "m4a";
  if (contentType.includes("mp4")) return "mp4";
  if (contentType.includes("quicktime")) return "mov";
  if (contentType.includes("mpeg")) return "mp3";
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("aac")) return "aac";

  return "dat";
}

function safeFolderName(value) {
  const folder = optionalString(value) || "admin-courses";
  const safeFolder = folder
    .replace(/\\/g, "/")
    .replace(/[^0-9a-zA-Z/_-]/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "");

  return safeFolder || "admin-courses";
}

function safeUploadId(value) {
  return optionalString(value)
    .replace(/[^0-9a-zA-Z_-]/g, "")
    .slice(0, 80) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function assetCloudPath(folder, extension) {
  return `${folder}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.${extension}`;
}

async function getTempFileURL(fileId) {
  if (!fileId) {
    return "";
  }

  const result = await app.getTempFileURL({
    fileList: [fileId]
  });
  const file = result?.fileList?.[0] || {};
  return optionalString(file.tempFileURL || file.tempFileUrl || file.url || file.download_url);
}

async function getTempFileURLs(fileIds = []) {
  const uniqueFileIds = [...new Set(fileIds.filter(Boolean))];
  if (uniqueFileIds.length === 0) {
    return {};
  }

  const result = await app.getTempFileURL({ fileList: uniqueFileIds });
  return (result?.fileList || []).reduce((urls, file, index) => {
    const fileId = file.fileID || file.fileId || uniqueFileIds[index];
    const url = optionalString(file.tempFileURL || file.tempFileUrl || file.url || file.download_url);
    if (fileId && url) {
      urls[fileId] = url;
    }
    return urls;
  }, {});
}

function pptCosClient() {
  const secretId = optionalString(process.env.TENCENTCLOUD_SECRETID || process.env.TENCENTCLOUD_SECRET_ID);
  const secretKey = optionalString(process.env.TENCENTCLOUD_SECRETKEY || process.env.TENCENTCLOUD_SECRET_KEY);
  const securityToken = optionalString(
    process.env.TENCENTCLOUD_SESSIONTOKEN
    || process.env.TENCENTCLOUD_SESSION_TOKEN
    || process.env.TENCENTCLOUD_TOKEN
  );
  if (!secretId || !secretKey) {
    const error = new Error("PPT 自动处理缺少云函数运行凭证，请检查函数角色配置");
    error.code = "PPT_COS_CREDENTIALS_REQUIRED";
    throw error;
  }
  return new COS({ SecretId: secretId, SecretKey: secretKey, ...(securityToken ? { SecurityToken: securityToken } : {}) });
}

function cosRequest(cos, options) {
  return new Promise((resolve, reject) => {
    cos.request(options, (error, data) => error ? reject(error) : resolve(data || {}));
  });
}

function cosGetBucket(cos, options) {
  return new Promise((resolve, reject) => {
    cos.getBucket(options, (error, data) => error ? reject(error) : resolve(data || {}));
  });
}

function cloudAuthorityBucket(authority) {
  const parts = optionalString(authority).split(".");
  return parts.length > 1 ? parts.slice(1).join(".") : "";
}

async function pptCosLocation(fileId) {
  const parsed = parseCloudFileId(fileId);
  const tempUrl = await getTempFileURL(fileId);
  if (!tempUrl) {
    const error = new Error("无法读取已上传的 PPT 文件");
    error.code = "PPT_SOURCE_UNAVAILABLE";
    throw error;
  }
  const location = parseCosLocation(tempUrl, {
    bucket: process.env.PPT_COS_BUCKET || cloudAuthorityBucket(parsed.authority),
    region: process.env.PPT_COS_REGION || process.env.TENCENTCLOUD_REGION || process.env.SCF_REGION
  });
  return { ...parsed, ...location };
}

async function listPptSlideKeys(cos, bucket, region, prefix) {
  const contents = [];
  let marker = "";
  do {
    const result = await cosGetBucket(cos, {
      Bucket: bucket,
      Region: region,
      Prefix: prefix,
      ...(marker ? { Marker: marker } : {}),
      MaxKeys: 1000
    });
    contents.push(...(Array.isArray(result.Contents) ? result.Contents : result.Contents ? [result.Contents] : []));
    marker = String(result.IsTruncated).toLowerCase() === "true"
      ? optionalString(result.NextMarker || result.Contents?.at?.(-1)?.Key)
      : "";
  } while (marker);
  return sortedSlideKeys(contents, prefix);
}

async function fetchCloudFileBuffer(fileId) {
  const url = await getTempFileURL(fileId);
  if (!url) {
    throw new Error("无法获取分片文件地址");
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`分片下载失败：${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function cleanupChunkFiles(fileIDs) {
  if (!Array.isArray(fileIDs) || fileIDs.length === 0 || typeof app.deleteFile !== "function") {
    return;
  }

  try {
    await app.deleteFile({ fileList: fileIDs });
  } catch (error) {
    console.warn("[adminData] 清理上传分片失败", error);
  }
}

function normalizeCoursePayload(payload = {}) {
  const track = payload.track === "chronic" ? "chronic" : "product";
  const status = payload.status === "draft" ? "draft" : "published";
  const chronicCategory = chronicCategories.includes(payload.chronicCategory) ? payload.chronicCategory : "";
  const slideImageFileIds = payload.resourceType === "ppt" && Array.isArray(payload.slideImageFileIds)
    ? [...new Set(payload.slideImageFileIds.map(optionalString).filter((fileId) => /^cloud(?:base)?:\/\//i.test(fileId)))]
    : [];
  const legacySlideCount = payload.resourceType === "ppt" ? requireNonNegativeInteger(payload.slideCount ?? 0, "slideCount") : 0;
  const pptProcessingStatus = payload.resourceType === "ppt"
    ? (slideImageFileIds.length > 0 ? "ready" : ["processing", "failed"].includes(payload.pptProcessingStatus) ? payload.pptProcessingStatus : "")
    : "";

  return {
    title: requireString(payload.title, "title"),
    duration: optionalString(payload.duration) || "10 分钟",
    description: optionalString(payload.description),
    goldenBeans: requireNonNegativeInteger(payload.goldenBeans ?? 0, "goldenBeans"),
    completionRate: Number(payload.completionRate || 0),
    status,
    track,
    productName: track === "product" ? optionalString(payload.productName) : "",
    productImage: optionalString(payload.productImage || payload.productImageUrl),
    productImageUrl: optionalString(payload.productImageUrl),
    chronicCategory: track === "chronic" ? chronicCategory : "",
    coverImage: optionalString(payload.coverImage || payload.coverImageUrl),
    coverImageUrl: optionalString(payload.coverImageUrl),
    videoUrl: optionalString(payload.videoUrl || payload.videoFileId),
    videoFileId: optionalString(payload.videoFileId),
    resourceType: ["pdf", "ppt", "doc", "video-link"].includes(payload.resourceType)
      ? payload.resourceType
      : "",
    resourceUrl: optionalString(payload.resourceUrl || payload.resourceFileId),
    resourceFileId: optionalString(payload.resourceFileId),
    resourceName: optionalString(payload.resourceName),
    resourceContentType: optionalString(payload.resourceContentType),
    slideCount: slideImageFileIds.length || legacySlideCount,
    slideImageFileIds,
    slideImagePrefix: payload.resourceType === "ppt" ? optionalString(payload.slideImagePrefix) : "",
    slideMinSeconds: payload.resourceType === "ppt" ? 3 : 0,
    pptProcessingStatus,
    pptConversionJobId: payload.resourceType === "ppt" ? optionalString(payload.pptConversionJobId) : "",
    sortOrder: Number(payload.sortOrder || 999),
    updatedAt: now()
  };
}

function publishedPptMissingSlides(course = {}) {
  return course.status === "published"
    && course.resourceType === "ppt"
    && !(
      Array.isArray(course.slideImageFileIds) && course.slideImageFileIds.length > 0
      || (Number(course.slideCount || 0) > 0 && optionalString(course.slideImagePrefix))
    );
}

function normalizeQuestionPayload(question = {}, index = 0) {
  const options = Array.isArray(question.options)
    ? question.options.map((item) => optionalString(item)).filter(Boolean)
    : [];
  const type = question.type === "multiple" ? "multiple" : "single";
  const answerIndexes = Array.isArray(question.answerIndexes)
    ? question.answerIndexes.map(Number).filter(Number.isFinite)
    : [];
  const answerIndex = Number(question.answerIndex || 0);

  if (!optionalString(question.prompt)) {
    throw new Error(`question ${index + 1} prompt is required`);
  }
  if (options.length < 2) {
    throw new Error(`question ${index + 1} needs at least 2 options`);
  }
  if (type === "multiple" && answerIndexes.length === 0) {
    throw new Error(`question ${index + 1} needs answers`);
  }

  return {
    prompt: optionalString(question.prompt),
    options,
    type,
    answerIndex: type === "single" ? answerIndex : 0,
    answerIndexes: type === "multiple" ? [...new Set(answerIndexes)].sort((a, b) => a - b) : [],
    explanation: optionalString(question.explanation),
    sortOrder: Number(question.sortOrder || (index + 1) * 10),
    updatedAt: now()
  };
}

function normalizeExamPayload(payload = {}) {
  const status = payload.status === "draft" ? "draft" : "published";
  const productName = requireString(payload.productName, "productName");
  return {
    title: optionalString(payload.title) || `${productName}产品答题`,
    productName,
    passScore: 90,
    goldenBeans: requireNonNegativeInteger(payload.goldenBeans ?? 0, "goldenBeans"),
    attempts: Number(payload.attempts || 0),
    passRate: Number(payload.passRate || 0),
    status,
    sortOrder: Number(payload.sortOrder || 999),
    groupKey: optionalString(payload.groupKey),
    subExamIndex: Number(payload.subExamIndex || 0),
    totalSubExams: Number(payload.totalSubExams || 0),
    updatedAt: now()
  };
}

function normalizePhrasePayload(payload = {}) {
  return {
    title: requireString(payload.title, "title"),
    script: requireString(payload.script, "script"),
    productName: requireString(payload.productName, "productName"),
    audioFileId: optionalString(payload.audioFileId),
    audioUrl: optionalString(payload.audioUrl),
    audioName: optionalString(payload.audioName),
    goldenBeans: requireNonNegativeInteger(payload.goldenBeans ?? 0, "goldenBeans"),
    maxRewardedAttempts: positiveInteger(
      requireNonNegativeInteger(payload.maxRewardedAttempts ?? 1, "maxRewardedAttempts"),
      1
    ),
    submissions: nonNegativeInteger(payload.submissions, 0),
    status: payload.status === "draft" ? "draft" : "published",
    sortOrder: nonNegativeInteger(payload.sortOrder, 999),
    updatedAt: now()
  };
}

function normalizeProductRewardRulePayload(payload = {}) {
  const productKey = requireString(payload.productKey, "productKey");
  return {
    productKey,
    productName: requireString(payload.productName, "productName"),
    rewardCap: requireNonNegativeInteger(payload.rewardCap ?? 0, "rewardCap"),
    status: payload.status === "inactive" ? "inactive" : "active",
    updatedAt: now()
  };
}

function normalizeStorePayload(payload, brand) {
  return {
    name: requireString(payload.name, "name"),
    regionId: optionalString(payload.regionId) || "default",
    brandId: brand._id,
    brandName: brand.name,
    storeNo: optionalString(payload.storeNo),
    address: optionalString(payload.address),
    organizationType: payload.organizationType === "department" ? "department" : "store",
    status: payload.status === "inactive" ? "inactive" : "active",
    updatedAt: now()
  };
}

function normalizeEmployeePayload(payload = {}) {
  const status = payload.status === "inactive" ? "inactive" : "active";
  const role = ["employee", "storeManager", "admin", "supplier"].includes(payload.role) ? payload.role : "employee";

  return {
    name: requireString(payload.name, "name"),
    employeeNo: requireString(payload.employeeNo, "employeeNo"),
    position: optionalString(payload.position),
    role,
    storeId: role === "supplier" ? optionalString(payload.storeId) : requireString(payload.storeId, "storeId"),
    regionId: optionalString(payload.regionId) || "default",
    goldenBeans: Math.max(0, Math.trunc(Number(payload.goldenBeans || 0))),
    courseCompletionRate: boundedPercentage(payload.courseCompletionRate, "课程完成率"),
    examPassRate: boundedPercentage(payload.examPassRate, "考试通过率"),
    avatarUrl: optionalString(payload.avatarUrl),
    supplierName: role === "supplier" ? optionalString(payload.supplierName) : "",
    supplierProductKeys: role === "supplier" && Array.isArray(payload.supplierProductKeys)
      ? payload.supplierProductKeys.map((item) => optionalString(item)).filter(Boolean)
      : [],
    source: "admin",
    status,
    updatedAt: now()
  };
}

async function ensureSupplierOrganization() {
  const existing = findSupplierOrganization(await getCollection(collections.stores, 1000));
  if (existing) {
    if (existing.status === "inactive") {
      await db.collection(collections.stores).doc(existing._id || existing.id).update({ status: "active", updatedAt: now() });
    }
    return { ...existing, status: "active" };
  }
  const brand = (await getCollection(collections.brands)).find((item) => item.status !== "inactive");
  if (!brand) throw new Error("请先配置品牌");
  const record = supplierOrganizationRecord(now(), brand);
  const result = await db.collection(collections.stores).add(record);
  return { _id: result.id, ...record };
}

async function validateSupplierProducts(productKeys = []) {
  if (!productKeys.length) return;
  const [courses, phrases, exams, tasks] = await Promise.all([
    getCollection(collections.courses, 1000),
    getCollection(collections.phrases, 1000),
    getCollection(collections.exams, 1000),
    getOptionalCollectionRecords(collections.employeeProductTasks, 5000)
  ]);
  const invalid = invalidSupplierProducts(productKeys, [courses, phrases, exams, tasks]);
  if (invalid.length) {
    throw Object.assign(new Error(`授权产品不存在：${invalid.join("、")}`), { code: "SUPPLIER_PRODUCT_NOT_FOUND" });
  }
}

function normalizeRewardPayload(payload = {}) {
  const status = payload.status === "inactive" ? "inactive" : "active";

  return {
    title: requireString(payload.title, "title"),
    description: optionalString(payload.description),
    goldenBeanPrice: Number(payload.goldenBeanPrice || 0),
    stock: Number(payload.stock || 0),
    status,
    imageUrl: optionalString(payload.imageUrl),
    nonDrugConfirmed: payload.nonDrugConfirmed === true,
    nonDrugConfirmedAt: optionalString(payload.nonDrugConfirmedAt) || now(),
    nonDrugConfirmedBy: "web-admin",
    sortOrder: Number(payload.sortOrder || 999),
    updatedAt: now()
  };
}

async function loadAdminData() {
  const [
    employees,
    employeeApplications,
    brands,
    stores,
    courses,
    phrases,
    exams,
    questions,
    popSubmissions,
    phraseSubmissions,
    cases,
    caseComments,
    caseLikes,
    goldenBeanLedger,
    rewards,
    redemptions,
    taskRewardRecords,
    productRewardRules,
    employeeProductTasks,
    storeProductSales,
    storeTaskRewards,
    storeReceipts,
    courseProgress,
    examAttempts,
    phrasePracticeAttempts,
    users,
    webSessions
  ] = await Promise.all([
    getCollection(collections.employees),
    getCollection(collections.employeeApplications, 1000).catch(() => []),
    getCollection(collections.brands).catch(() => []),
    getCollection(collections.stores),
    getCollection(collections.courses),
    getCollection(collections.phrases),
    getCollection(collections.exams),
    getCollection(collections.questions, 1000),
    getCollection(collections.popSubmissions),
    getCollection(collections.phraseSubmissions),
    getCollection(collections.cases, 1000),
    getCollection(collections.caseComments, 1000).catch(() => []),
    getCollection(collections.caseLikes, 1000).catch(() => []),
    getCollection(collections.goldenBeanLedger),
    getCollection(collections.rewards),
    getCollection(collections.redemptions),
    getCollection(collections.taskRewards).catch(() => []),
    getCollection(collections.productRewardRules).catch(() => []),
    getCollection(collections.employeeProductTasks, 5000).catch(() => []),
    getOptionalCollectionRecords(collections.storeProductSales, 5000),
    getOptionalCollectionRecords(collections.storeTaskRewards, 1000),
    getOptionalCollectionRecords(collections.storeReceipts, 5000),
    getCollection(collections.courseProgress, 5000).catch(() => []),
    getCollection(collections.examAttempts, 5000).catch(() => []),
    getCollection(collections.phrasePracticeAttempts, 5000).catch(() => []),
    getOptionalCollectionRecords(collections.users, 5000),
    getOptionalCollectionRecords(collections.webSessions, 5000)
  ]);
  const taskRewards = buildTaskRewards(taskRewardRecords);
  const visibleCaseComments = caseComments.filter((item) => !item.deletedAt);
  const caseImageFileIds = cases.flatMap((item) => normalizeCaseImages(item).map((image) => image.fileId));
  const caseVideoFileIds = cases.map((item) => (
    optionalString(item.videoFileId)
      || (/^(cloud|cloudbase):\/\//i.test(optionalString(item.videoUrl)) ? optionalString(item.videoUrl) : "")
  )).filter(Boolean);
  const caseMediaUrls = await getTempFileURLs([...caseImageFileIds, ...caseVideoFileIds]).catch(() => ({}));
  const normalizedCases = cases.map((item) => ({
    ...item,
    type: "case",
    goldenBeans: Number(item.goldenBeans ?? taskRewards.case ?? 0),
    images: normalizeCaseImages(item).map((image) => ({
      ...image,
      url: image.fileId ? caseMediaUrls[image.fileId] || image.imageUrl : image.imageUrl
    })),
    videoUrl: optionalString(item.videoFileId)
      ? caseMediaUrls[optionalString(item.videoFileId)] || ""
      : /^(cloud|cloudbase):\/\//i.test(optionalString(item.videoUrl))
        ? caseMediaUrls[optionalString(item.videoUrl)] || ""
        : optionalString(item.videoUrl),
    commentCount: visibleCaseComments.filter((comment) => comment.caseId === (item._id || item.id)).length,
    likeCount: caseLikes.filter((like) => like.caseId === (item._id || item.id)).length
  }));

  const employeeMetrics = new Map(employees.map((employee) => [
    employee._id || employee.id,
    learningMetricsForEmployee({
      employeeId: employee._id || employee.id,
      courses,
      courseProgress,
      phrases,
      phrasePracticeAttempts,
      goldenBeanLedger,
      exams,
      examAttempts,
      employeeProductTasks,
      productTaskPeriodKey: currentPeriodKey()
    })
  ]));
  const normalizedEmployees = employees.map((employee) => ({
      ...normalizeId(employee),
      courseCompletionRate: employeeMetrics.get(employee._id || employee.id)?.courseCompletionRate || 0,
      examPassRate: employeeMetrics.get(employee._id || employee.id)?.examPassRate || 0,
      contentCompletionRate: employeeMetrics.get(employee._id || employee.id)?.contentCompletionRate || 0,
      wechatBound: users.some((user) => String(user.employeeId || "") === String(employee._id || employee.id) && user.status === "active"),
      wechatBindingCount: users.filter((user) => String(user.employeeId || "") === String(employee._id || employee.id) && user.status === "active").length,
      wechatNickname: users.find((user) => String(user.employeeId || "") === String(employee._id || employee.id) && user.status === "active")?.nickname || employee.wechatNickname || ""
    }));
  const data = {
    employees: normalizedEmployees,
    employeeApplications: employeeApplications
      .map(normalizeEmployeeApplication)
      .sort((left, right) => String(right.submittedAt || "").localeCompare(String(left.submittedAt || ""))),
    brands: brands.map(normalizeId),
    stores: stores.map(normalizeId),
    courses: courses.map(normalizeId),
    phrases: phrases.map(normalizeId),
    exams: exams.map((exam) => {
      const normalizedExam = normalizeId(exam);
      return {
        ...normalizedExam,
        questionCount: questions.filter((question) => question.examId === normalizedExam.id).length
      };
    }),
    questions: questions.map(normalizeId),
    submissions: [...popSubmissions, ...phraseSubmissions, ...normalizedCases.filter((item) => !item.deletedAt)].map(normalizeSubmission),
    caseComments: visibleCaseComments.map(normalizeId),
    goldenBeanLedger: goldenBeanLedger.map(normalizeId),
    rewards: rewards.map(normalizeId),
    redemptions: redemptions.map(normalizeId),
    taskRewards,
    productRewardRules: productRewardRules.map(normalizeId),
    employeeProductTasks: employeeProductTasks.map((item) => {
      const normalized = normalizeId(item);
      const target = Number(normalized.targetQuantity || 0);
      const completed = Math.max(0, Number(normalized.completedQuantity || 0));
      return {
        ...normalized,
        completedQuantity: completed,
        attainmentRate: target > 0 ? Math.min(100, Math.round(completed / target * 100)) : 0
      };
    }),
    storeProductSales: storeProductSales.map((item) => {
      const target = Math.max(0, Number(item.targetQuantity || 0));
      const completed = Math.max(0, Number(item.completedQuantity || 0));
      return {
        ...normalizeId(item),
        targetQuantity: target,
        completedQuantity: completed,
        attainmentRate: target > 0 ? Math.min(100, Math.round(completed / target * 100)) : 0
      };
    }),
    storeTaskRewards: storeTaskRewards.map((item) => ({ ...normalizeId(item), threshold: 10 })),
    storeReceipts: storeReceipts.map(normalizeId),
    courseProgress: courseProgress.map(normalizeId),
    examAttempts: examAttempts.map(normalizeId),
    phrasePracticeAttempts: phrasePracticeAttempts.map(normalizeId),
    supplierViews: buildSupplierViews({
      employees: normalizedEmployees,
      stores,
      courses,
      phrases,
      exams,
      courseProgress,
      phrasePracticeAttempts,
      goldenBeanLedger,
      examAttempts,
      employeeProductTasks
    })
  };

  return {
    ...data,
    dashboardStats: buildDashboardStats(data)
  };
}

async function reviewStoreReceipt(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) return secretError;
  const receiptId = optionalString(payload.receiptId || payload.id);
  const decision = payload.decision === "approved" ? "approved" : payload.decision === "rejected" ? "rejected" : "";
  if (!receiptId || !decision) return fail("小票审核参数不完整", "RECEIPT_REVIEW_INVALID");
  const receipt = await getFirst(collections.storeReceipts, { _id: receiptId });
  if (!receipt) return fail("小票不存在", "RECEIPT_NOT_FOUND");
  if (receipt.status !== "review") return fail("该小票已经处理过", "RECEIPT_ALREADY_REVIEWED");
  if (decision === "rejected") {
    await db.collection(collections.storeReceipts).doc(receiptId).update({ status: "rejected", reviewReason: optionalString(payload.rejectReason) || "后台驳回", reviewedAt: now() });
    return ok({ receipt: { ...normalizeId(receipt), status: "rejected" } });
  }
  const periodKey = currentPeriodKey();
  const result = await db.runTransaction(async (transaction) => {
    const current = (await transaction.collection(collections.storeReceipts).doc(receiptId).get()).data;
    if (!current || current.status !== "review") return { already: true, receipt: current };
    await transaction.collection(collections.storeReceipts).doc(receiptId).update({ status: "approved", reviewedAt: now(), countedAt: now(), countedQuantity: Number(current.quantity || 0) });
    const sales = await transaction.collection(collections.storeProductSales).where({ storeId: current.storeId, productKey: current.productKey, periodKey }).limit(1).get().catch(() => ({ data: [] }));
    const sale = sales.data?.[0];
    if (sale) await transaction.collection(collections.storeProductSales).doc(sale._id).update({ completedQuantity: command.inc(Number(current.quantity || 0)), updatedAt: now() });
    return { receipt: { ...current, status: "approved" }, addedQuantity: sale ? Number(current.quantity || 0) : 0, taskMissing: !sale };
  });
  if (result.already) return fail("该小票已经处理过", "RECEIPT_ALREADY_REVIEWED");
  return ok(result);
}

async function saveStore(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) {
    return secretError;
  }

  const storeId = optionalString(payload.storeId || payload.id);
  const brandId = optionalString(payload.brandId);
  const brand = brandId ? await getFirst(collections.brands, { _id: brandId }) : null;
  if (!brand || brand.status === "inactive") return fail("请选择有效品牌", "INVALID_BRAND");
  const store = normalizeStorePayload(payload, brand);

  if (storeId) {
    const existingStore = await getFirst(collections.stores, { _id: storeId });
    if (!existingStore) {
      return fail("Store not found", "STORE_NOT_FOUND");
    }

    await db.collection(collections.stores).doc(storeId).update(store);
    return ok({
      store: {
        id: storeId,
        ...store
      }
    });
  }

  const existingStore = await getFirst(collections.stores, { name: store.name, brandId: store.brandId });
  if (existingStore) {
    return fail("门店名称已存在", "STORE_EXISTS");
  }

  const result = await db.collection(collections.stores).add({
    ...store,
    createdAt: now()
  });

  return ok({
    store: {
      id: result.id,
      ...store
    }
  });
}

async function saveEmployee(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) {
    return secretError;
  }

  const employeeId = optionalString(payload.employeeId || payload.id);
  const employee = normalizeEmployeePayload(payload);
  if (employee.role === "supplier") {
    await validateSupplierProducts(employee.supplierProductKeys);
  }
  const store = employee.role === "supplier"
    ? await ensureSupplierOrganization()
    : await getFirst(collections.stores, { _id: employee.storeId });
  if (!store) {
    return fail("请选择有效门店", "STORE_NOT_FOUND");
  }
  employee.storeId = store._id || store.id;
  employee.regionId = optionalString(store.regionId) || employee.regionId || "default";

  const allEmployees = await getCollection(collections.employees, 1000);
  const duplicateNameInStore = allEmployees.find((item) => (
    String(item.storeId || "") === employee.storeId
    && normalizedEmployeeName(item.name) === normalizedEmployeeName(employee.name)
    && String(item._id || item.id || "") !== employeeId
  ));
  if (duplicateNameInStore) {
    return fail("该门店已存在同名员工，请核对姓名或门店", "EMPLOYEE_NAME_STORE_EXISTS");
  }

  const duplicateEmployeeNo = allEmployees.find((item) => optionalString(item.employeeNo).toLowerCase() === employee.employeeNo.toLowerCase());
  if (duplicateEmployeeNo && duplicateEmployeeNo._id !== employeeId) {
    return fail("员工编号已存在", "EMPLOYEE_NO_EXISTS");
  }

  if (employeeId) {
    const existingEmployee = await getFirst(collections.employees, { _id: employeeId });
    if (!existingEmployee) {
      return fail("Employee not found", "EMPLOYEE_NOT_FOUND");
    }

    const inactiveAt = employee.status === "inactive" ? existingEmployee.inactiveAt || employee.updatedAt : "";
    await db.collection(collections.employees).doc(employeeId).update({
      ...employee,
      avatarUrl: employee.avatarUrl || existingEmployee.avatarUrl || "",
      inactiveAt
    });
    const mediaResult = await db.collection(collections.webMediaUploads).where({ employeeId }).limit(1000).get().catch(() => ({ data: [] }));
    await Promise.all((mediaResult.data || [])
      .filter((media) => String(media.contentType || "").startsWith("audio/") && !media.deletedAt)
      .map((media) => db.collection(collections.webMediaUploads).doc(media._id).update({
        retentionExpiresAt: employee.status === "inactive" ? recordingRetentionExpiry(inactiveAt) : "",
        updatedAt: employee.updatedAt
      })));
    const userResult = await db.collection("users").where({ employeeId }).limit(100).get();
    await Promise.all((userResult.data || []).map((user) => (
      db.collection("users").doc(user._id).update({
        role: employee.role,
        updatedAt: now()
      })
    )));
    return ok({
      employee: {
        id: employeeId,
        ...employee,
        avatarUrl: employee.avatarUrl || existingEmployee.avatarUrl || ""
      }
    });
  }

  const result = await db.collection(collections.employees).add({
    ...employee,
    createdAt: now()
  });

  return ok({
    employee: {
      id: result.id,
      ...employee
    }
  });
}

async function importEmployees(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) return secretError;
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const [stores, employees] = await Promise.all([
    getCollection(collections.stores, 1000),
    getCollection(collections.employees, 1000)
  ]);
  const plan = buildEmployeeImportPlan({ rows, stores, employees, timestamp: now() });
  if (payload.dryRun === true) {
    return ok({ committed: false, ...plan });
  }
  if (plan.errors.length > 0) {
    return fail("员工名单存在错误，请重新预检后再导入", "EMPLOYEE_IMPORT_INVALID", { errors: plan.errors, summary: plan.summary });
  }

  for (let start = 0; start < plan.items.length; start += 20) {
    const batch = plan.items.slice(start, start + 20);
    await Promise.all(batch.map(async (item) => {
      if (item.action === "update") {
        await db.collection(collections.employees).doc(item.employeeId).update(item.document);
        return;
      }
      await db.collection(collections.employees).add({
        ...item.document,
        goldenBeans: 0,
        courseCompletionRate: 0,
        examPassRate: 0,
        avatarUrl: "",
        createdAt: item.document.updatedAt
      });
    }));
  }
  return ok({ committed: true, ...plan });
}

async function loadLegacyDuplicateCleanupContext() {
  const [employees, users, webSessions, ...relationRecordSets] = await Promise.all([
    getCollection(collections.employees, 1000),
    getOptionalCollectionRecords(collections.users, 1000),
    getOptionalCollectionRecords(collections.webSessions, 1000),
    ...legacyEmployeeRelationCollections.map((collectionName) => getOptionalCollectionRecords(collectionName, 5000))
  ]);
  const recordsByCollection = Object.fromEntries(
    legacyEmployeeRelationCollections.map((collectionName, index) => [collectionName, relationRecordSets[index]])
  );
  const plan = buildLegacyDuplicateEmployeeCleanupPlan({ employees });
  const candidateIds = new Set(plan.candidates.map((item) => item.legacyEmployeeId));
  const relationCounts = Object.fromEntries(legacyEmployeeRelationCollections.map((collectionName) => [
    collectionName,
    recordsByCollection[collectionName].filter((record) => candidateIds.has(optionalString(record.employeeId))).length
  ]));
  relationCounts[collections.users] = users.filter((record) => candidateIds.has(optionalString(record.employeeId))).length;
  relationCounts[collections.webSessions] = webSessions.filter((record) => candidateIds.has(optionalString(record.employeeId))).length;

  return {
    employees,
    users,
    webSessions,
    recordsByCollection,
    plan,
    relationCounts,
    collisions: findRelationCollisions({ candidates: plan.candidates, recordsByCollection })
  };
}

function publicLegacyCleanupPreview(context) {
  return {
    committed: false,
    summary: {
      ...context.plan.summary,
      collisionCount: context.collisions.length,
      relationCounts: context.relationCounts
    },
    candidateIds: context.plan.candidates.map((item) => item.legacyEmployeeId),
    candidates: context.plan.candidates,
    protectedWithBalance: context.plan.skippedWithBalance,
    skippedUnsafe: context.plan.skippedUnsafe,
    collisions: context.collisions
  };
}

async function getOptionalWhere(collectionName, filter, limit = 1000) {
  try {
    const result = await db.collection(collectionName).where(filter).limit(limit).get();
    return result.data || [];
  } catch (error) {
    if (isMissingCollectionError(error)) return [];
    throw error;
  }
}

async function restoreLegacyCleanupLocks(employeeIds = []) {
  await Promise.all(employeeIds.map(async (id) => {
    const employee = await getFirst(collections.employees, { _id: id });
    if (!employee || optionalString(employee.status) !== "legacy-duplicate-merging") return;
    await db.collection(collections.employees).doc(id).update({
      status: "active",
      cleanupState: "",
      cleanupLockedAt: "",
      updatedAt: now()
    });
  }));
}

async function migrateLegacyEmployee(candidate, timestamp) {
  const legacyId = candidate.legacyEmployeeId;
  const formalId = candidate.formalEmployeeId;
  const migratedCounts = {};
  const [users, sessionRecords, ...relationRecordSets] = await Promise.all([
    getOptionalWhere(collections.users, { employeeId: legacyId }, 1000),
    getOptionalWhere(collections.webSessions, { employeeId: legacyId }, 1000),
    ...legacyEmployeeRelationCollections.map((collectionName) => getOptionalWhere(collectionName, { employeeId: legacyId }, 5000))
  ]);
  const relationUpdates = [];
  legacyEmployeeRelationCollections.forEach((collectionName, index) => {
    const records = relationRecordSets[index];
    migratedCounts[collectionName] = records.length;
    for (const record of records) {
      relationUpdates.push(db.collection(collectionName).doc(record._id).update({
        employeeId: formalId,
        mergedFromEmployeeId: legacyId,
        mergedAt: timestamp,
        updatedAt: timestamp
      }));
    }
  });
  await Promise.all(relationUpdates);

  await Promise.all(users.map((user) => db.collection(collections.users).doc(user._id).update({
    employeeId: formalId,
    role: candidate.formalRole,
    status: "active",
    mergedFromEmployeeId: legacyId,
    mergedAt: timestamp,
    updatedAt: timestamp
  })));
  migratedCounts[collections.users] = users.length;

  const sessionById = new Map(sessionRecords.map((session) => [session._id, session]));
  const userSessionSets = await Promise.all(users
    .filter((user) => user.openId)
    .map((user) => getOptionalWhere(collections.webSessions, { openId: user.openId }, 1000)));
  for (const openIdSessions of userSessionSets) {
    for (const session of openIdSessions) sessionById.set(session._id, session);
  }
  await Promise.all([...sessionById.values()].map((session) => (
    db.collection(collections.webSessions).doc(session._id).update({
      employeeId: formalId,
      status: "inactive",
      mergedFromEmployeeId: legacyId,
      mergedAt: timestamp,
      updatedAt: timestamp
    })
  )));
  migratedCounts[collections.webSessions] = sessionById.size;

  await db.collection(collections.employees).doc(legacyId).remove();
  await db.collection(collections.auditLogs).add({
    action: "legacy_duplicate_employee_merged",
    targetType: "employee",
    targetId: legacyId,
    result: "deleted",
    mergedIntoEmployeeId: formalId,
    employeeName: candidate.name,
    storeId: candidate.storeId,
    migratedCounts,
    createdBy: "web-admin",
    createdAt: timestamp
  });

  return {
    legacyEmployeeId: legacyId,
    formalEmployeeId: formalId,
    name: candidate.name,
    migratedCounts
  };
}

async function cleanupLegacyDuplicateEmployees(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) return secretError;

  const context = await loadLegacyDuplicateCleanupContext();
  if (payload.dryRun === true || payload.commit !== true) {
    return ok(publicLegacyCleanupPreview(context));
  }
  if (optionalString(payload.confirmation) !== legacyCleanupConfirmation) {
    return fail("缺少重复员工清理确认词", "LEGACY_CLEANUP_CONFIRMATION_REQUIRED");
  }
  if (context.collisions.length > 0) {
    return fail("发现学习或积分历史冲突，已停止清理", "LEGACY_CLEANUP_RELATION_COLLISION", {
      collisions: context.collisions
    });
  }

  const expectedCandidateIds = Array.isArray(payload.expectedCandidateIds) ? payload.expectedCandidateIds : [];
  const currentCandidateIds = context.plan.candidates.map((item) => item.legacyEmployeeId);
  if (!sameEmployeeIdSet(expectedCandidateIds, currentCandidateIds)) {
    return fail("候选员工名单已经变化，请重新执行预检", "LEGACY_CLEANUP_PLAN_CHANGED", {
      summary: context.plan.summary,
      candidateIds: currentCandidateIds
    });
  }

  const lockedIds = [];
  try {
    const currentEmployees = await Promise.all(context.plan.candidates.map((candidate) => (
      getFirst(collections.employees, { _id: candidate.legacyEmployeeId })
    )));
    const changedIndex = currentEmployees.findIndex((employee) => !employee || Number(employee.goldenBeans || 0) > 0);
    if (changedIndex !== -1) {
      return fail("员工积分或记录已变化，请重新执行预检", "LEGACY_CLEANUP_EMPLOYEE_CHANGED", {
        legacyEmployeeId: context.plan.candidates[changedIndex].legacyEmployeeId
      });
    }
    await Promise.all(context.plan.candidates.map((candidate) => (
      db.collection(collections.employees).doc(candidate.legacyEmployeeId).update({
        status: "legacy-duplicate-merging",
        cleanupState: "legacy-duplicate-merging",
        cleanupLockedAt: now(),
        updatedAt: now()
      })
    )));
    lockedIds.push(...context.plan.candidates.map((candidate) => candidate.legacyEmployeeId));

    const merged = [];
    for (let start = 0; start < context.plan.candidates.length; start += 5) {
      const batch = context.plan.candidates.slice(start, start + 5);
      merged.push(...await Promise.all(batch.map((candidate) => migrateLegacyEmployee(candidate, now()))));
    }
    return ok({
      committed: true,
      deletedCount: merged.length,
      protectedWithBalanceCount: context.plan.skippedWithBalance.length,
      merged
    });
  } catch (error) {
    await restoreLegacyCleanupLocks(lockedIds).catch(() => {});
    throw error;
  }
}

async function reviewEmployeeApplicationAction(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) return secretError;
  const applicationId = requireString(payload.applicationId, "applicationId");
  const decision = requireString(payload.decision, "decision");
  const rejectionReason = optionalString(payload.rejectionReason);

  return db.runTransaction(async (transaction) => {
    const applicationResult = await transaction.collection(collections.employeeApplications).where({ _id: applicationId }).limit(1).get();
    const application = applicationResult.data?.[0];
    if (!application) return fail("员工申请不存在", "EMPLOYEE_APPLICATION_NOT_FOUND");
    const reviewed = reviewEmployeeApplication(application, {
      decision,
      rejectionReason,
      reviewedBy: "web-admin",
      now
    });
    if (reviewed.alreadyReviewed) {
      return ok({
        application: normalizeEmployeeApplication(application),
        alreadyReviewed: true
      });
    }

    let user = null;
    if (reviewed.employee) {
      const sessionResult = await transaction.collection(collections.webSessions).where({ applicationId }).limit(100).get();
      const applicationSession = (sessionResult.data || [])
        .filter((item) => item.openId)
        .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))[0];
      if (!applicationSession?.openId) {
        throw Object.assign(new Error("申请的登录记录已失效，请员工重新打开 H5 后再审核"), { code: "APPLICATION_SESSION_NOT_FOUND" });
      }
      const existingUserResult = await transaction.collection(collections.users).where({ openId: applicationSession.openId }).limit(1).get();
      const existingUser = existingUserResult.data?.[0];
      if (existingUser?.employeeId && existingUser.employeeId !== reviewed.employee._id) {
        throw Object.assign(new Error("该登录身份已经绑定其他员工账号"), { code: "LOGIN_IDENTITY_ALREADY_BOUND" });
      }
      const existingEmployeeResult = await transaction.collection(collections.employees).where({ _id: reviewed.employee._id }).limit(1).get();
      const existingEmployee = existingEmployeeResult.data?.[0];
      if (existingEmployee && existingEmployee.applicationId !== applicationId) {
        throw Object.assign(new Error("该登录身份对应的员工账号已被其他申请占用"), { code: "EMPLOYEE_ID_CONFLICT" });
      }
      const { _id: employeeId, ...employeeDocument } = reviewed.employee;
      await transaction.collection(collections.employees).doc(employeeId).set(employeeDocument);
      const userRecord = {
        openId: applicationSession.openId,
        employeeId,
        role: reviewed.employee.role,
        status: "active",
        applicationId,
        createdAt: existingUser?.createdAt || now(),
        updatedAt: now()
      };
      const userId = existingUser?._id || userIdForOpenId(applicationSession.openId);
      await transaction.collection(collections.users).doc(userId).set(userRecord);
      user = { id: userId, employeeId };
      const sessionsResult = await transaction.collection(collections.webSessions).where({ openId: applicationSession.openId, status: "active" }).limit(100).get();
      await Promise.all((sessionsResult.data || []).map((session) => transaction.collection(collections.webSessions).doc(session._id).update({
        employeeId,
        applicationId,
        updatedAt: now()
      })));
    }

    const { _id, ...applicationUpdate } = reviewed.application;
    await transaction.collection(collections.employeeApplications).doc(applicationId).update(applicationUpdate);
    await transaction.collection(collections.auditLogs).add({
      action: decision === "approved" ? "employee_application_approved" : "employee_application_rejected",
      targetType: "employeeApplication",
      targetId: applicationId,
      result: decision,
      reason: rejectionReason,
      createdBy: "web-admin",
      createdAt: now()
    });
    return ok({
      application: normalizeEmployeeApplication(reviewed.application),
      employee: reviewed.employee ? normalizeId(reviewed.employee) : null,
      user,
      alreadyReviewed: false
    });
  });
}

async function unbindEmployeeWechat(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) {
    return secretError;
  }

  const employeeId = requireString(payload.employeeId, "employeeId");
  const userResult = await db.collection("users").where({ employeeId, status: "active" }).limit(100).get().catch((error) => {
    if (isMissingCollectionError(error)) return { data: [] };
    throw error;
  });
  const users = userResult.data || [];
  const sessionResult = await db.collection(collections.webSessions).where({ employeeId, status: "active" }).limit(500).get().catch((error) => {
    if (isMissingCollectionError(error)) return { data: [] };
    throw error;
  });
  const sessions = sessionResult.data || [];

  await Promise.all(users.map((user) => (
    db.collection("users").doc(user._id).update({
      status: "inactive",
      updatedAt: now()
    })
  )));
  await Promise.all(sessions.map((session) => (
    db.collection(collections.webSessions).doc(session._id).update({ status: "inactive", updatedAt: now() })
  )));

  await db.collection(collections.auditLogs).add({
    action: "employee_wechat_unbound",
    targetType: "employee",
    targetId: employeeId,
    userCount: users.length,
    sessionCount: sessions.length,
    createdBy: "web-admin",
    createdAt: now()
  });

  return ok({
    employeeId,
    unboundCount: users.length,
    invalidatedSessionCount: sessions.length
  });
}

async function resetEmployeeGoldenBeans(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) return secretError;
  if (payload.confirmation !== "确认清零") return fail("请输入“确认清零”后再执行", "RESET_CONFIRMATION_REQUIRED");

  const employees = await getCollection(collections.employees, 5000);
  const activeEmployees = employees.filter(isEmployeeResetTarget);
  let resetLedgerCount = 0;
  for (const employee of activeEmployees) {
    const employeeId = employee._id || employee.id;
    if (!employeeId) continue;
    if (Number(employee.goldenBeans || 0) !== 0) {
      await db.collection(collections.employees).doc(employeeId).update({ goldenBeans: 0, updatedAt: now() });
    }
    const ledgerResult = await db.collection(collections.goldenBeanLedger).add({
      employeeId,
      sourceType: "admin-reset",
      sourceId: `reset-golden-beans-${Date.now()}-${employeeId}`,
      delta: 0,
      reason: "管理员一键清零积分",
      createdBy: "web-admin",
      createdAt: now()
    });
    if (ledgerResult?.id) resetLedgerCount += 1;
  }
  await db.collection(collections.auditLogs).add({
    action: "employee_golden_beans_reset",
    targetType: "organization",
    targetId: "current-organization",
    employeeCount: activeEmployees.length,
    createdBy: "web-admin",
    createdAt: now()
  });
  return ok({ employeeCount: activeEmployees.length, resetLedgerCount });
}

async function removeEmployeeRelationRecords(collectionName, employeeIds) {
  if (!employeeIds.length) return 0;
  const records = await getOptionalCollectionRecords(collectionName, 10000);
  const targets = records.filter((record) => employeeIds.has(String(record.employeeId || "")));
  for (const record of targets) {
    await db.collection(collectionName).doc(record._id).remove();
  }
  return targets.length;
}

async function resetEmployeeLearningProgress(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) return secretError;
  if (payload.confirmation !== "确认清零") return fail("请输入“确认清零”后再执行", "RESET_CONFIRMATION_REQUIRED");

  const employees = await getCollection(collections.employees, 5000);
  const activeEmployees = employees.filter(isEmployeeResetTarget);
  const employeeIds = new Set(activeEmployees.map((employee) => String(employee._id || employee.id)).filter(Boolean));
  const [deletedCourseProgress, deletedProductTasks, deletedExamAttempts, deletedPhraseAttempts] = await Promise.all([
    removeEmployeeRelationRecords(collections.courseProgress, employeeIds),
    removeEmployeeRelationRecords(collections.employeeProductTasks, employeeIds),
    removeEmployeeRelationRecords(collections.examAttempts, employeeIds),
    removeEmployeeRelationRecords(collections.phrasePracticeAttempts, employeeIds)
  ]);
  await Promise.all(activeEmployees.map((employee) => db.collection(collections.employees).doc(employee._id || employee.id).update({
    courseCompletionRate: 0,
    examPassRate: 0,
    updatedAt: now()
  })));
  await db.collection(collections.auditLogs).add({
    action: "employee_learning_progress_reset",
    targetType: "organization",
    targetId: "current-organization",
    employeeCount: activeEmployees.length,
    deletedCourseProgress,
    deletedProductTasks,
    deletedExamAttempts,
    deletedPhraseAttempts,
    createdBy: "web-admin",
    createdAt: now()
  });
  return ok({ employeeCount: activeEmployees.length, deletedCourseProgress, deletedProductTasks, deletedExamAttempts, deletedPhraseAttempts });
}

async function saveTaskRewards(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) {
    return secretError;
  }

  const taskRewards = {
    pop: requireNonNegativeInteger(payload.pop ?? defaultTaskRewards.pop, "pop"),
    phrase: requireNonNegativeInteger(payload.phrase ?? defaultTaskRewards.phrase, "phrase"),
    case: requireNonNegativeInteger(payload.case ?? defaultTaskRewards.case, "case")
  };

  await Promise.all(Object.entries(taskRewards).map(async ([taskType, goldenBeans]) => {
    const existing = await getFirst(collections.taskRewards, { _id: taskType });
    const record = {
      goldenBeans,
      updatedAt: now()
    };

    if (existing) {
      return db.collection(collections.taskRewards).doc(taskType).update(record);
    }

    return db.collection(collections.taskRewards).add({
      _id: taskType,
      ...record,
      createdAt: now()
    });
  }));

  return ok({ taskRewards });
}

async function saveReward(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) {
    return secretError;
  }

  try {
    assertNonDrugRewardConfirmation(payload.nonDrugConfirmed);
  } catch (error) {
    return fail(error.message, error.code);
  }
  const rewardId = optionalString(payload.rewardId || payload.id);
  const reward = normalizeRewardPayload(payload);

  if (reward.goldenBeanPrice <= 0) {
    return fail("兑换金豆必须大于 0", "INVALID_REWARD_PRICE");
  }

  if (reward.stock < 0) {
    return fail("库存不能小于 0", "INVALID_REWARD_STOCK");
  }

  if (rewardId) {
    const existingReward = await getFirst(collections.rewards, { _id: rewardId });
    if (!existingReward) {
      return fail("Reward not found", "REWARD_NOT_FOUND");
    }

    await db.collection(collections.rewards).doc(rewardId).update(reward);
    return ok({
      reward: {
        id: rewardId,
        ...reward
      }
    });
  }

  const result = await db.collection(collections.rewards).add({
    ...reward,
    createdAt: now()
  });

  return ok({
    reward: {
      id: result.id,
      ...reward
    }
  });
}

async function fulfillRedemption(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) {
    return secretError;
  }

  const redemptionId = requireString(payload.redemptionId, "redemptionId");
  const redemption = await getFirst(collections.redemptions, { _id: redemptionId });
  if (!redemption) {
    return fail("Redemption not found", "REDEMPTION_NOT_FOUND");
  }

  if (redemption.status === "fulfilled") {
    return ok({
      redemptionId,
      alreadyFulfilled: true
    });
  }

  await db.collection(collections.redemptions).doc(redemptionId).update({
    status: "fulfilled",
    fulfilledAt: now(),
    fulfilledBy: "web-admin",
    fulfillRemark: optionalString(payload.fulfillRemark)
  });

  return ok({
    redemptionId,
    alreadyFulfilled: false
  });
}

async function adjustGoldenBeans(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) {
    return secretError;
  }

  const employeeId = requireString(payload.employeeId, "employeeId");
  const reason = requireString(payload.reason, "reason");
  const delta = Number(payload.delta);

  if (!Number.isFinite(delta) || delta === 0) {
    return fail("调整金豆必须填写非 0 数字", "INVALID_DELTA");
  }

  const employee = await getFirst(collections.employees, { _id: employeeId, status: "active" });
  if (!employee) {
    return fail("Employee not found", "EMPLOYEE_NOT_FOUND");
  }

  const nextGoldenBeans = Number(employee.goldenBeans || 0) + delta;
  if (nextGoldenBeans < 0) {
    return fail("扣减后金豆不能小于 0", "NEGATIVE_GOLDEN_BEANS");
  }

  await db.collection(collections.employees).doc(employeeId).update({
    goldenBeans: command.inc(delta),
    updatedAt: now()
  });

  const ledger = {
    employeeId,
    sourceType: "manual",
    sourceId: `manual-${Date.now()}`,
    delta,
    reason,
    createdBy: "web-admin",
    createdAt: now()
  };
  const ledgerResult = await db.collection(collections.goldenBeanLedger).add(ledger);

  return ok({
    ledger: {
      id: ledgerResult.id,
      ...ledger
    },
    employeeId,
    nextGoldenBeans
  });
}

async function reviewSubmission(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) {
    return secretError;
  }
  const submissionType = requireString(payload.submissionType, "submissionType");
  const submissionId = requireString(payload.submissionId, "submissionId");
  const decision = requireString(payload.decision, "decision");
  const rejectReason = typeof payload.rejectReason === "string" ? payload.rejectReason : "";

  if (!["approved", "rejected"].includes(decision)) {
    return fail("Decision must be approved or rejected", "INVALID_DECISION");
  }
  if (decision === "rejected" && !rejectReason.trim()) {
    return fail("请填写驳回原因", "REJECT_REASON_REQUIRED");
  }
  if (submissionType === "case" && decision === "approved") {
    try {
      assertAdminCasePrivacyConfirmation({ confirmed: payload.casePrivacyConfirmed, version: payload.casePrivacyVersion });
    } catch (error) {
      return fail(error.message, error.code);
    }
  }

  const collectionName = collectionByType[submissionType];
  if (!collectionName) {
    return fail("Unsupported submission type", "INVALID_SUBMISSION_TYPE");
  }

  const submission = await getFirst(collectionName, { _id: submissionId });
  if (!submission) {
    return fail("Submission not found", "SUBMISSION_NOT_FOUND");
  }
  if (submission.status !== "pending") {
    return ok({
      alreadyReviewed: true,
      submissionId,
      status: submission.status,
      award: null
    });
  }

  await db.collection(collectionName).doc(submissionId).update({
    status: decision,
    rejectReason: decision === "rejected" ? rejectReason : "",
    reviewedBy: "web-admin",
    reviewedAt: now()
  });

  let award = null;
  if (decision === "approved") {
    const productKey = optionalString(submission.productId || submission.productName || submission.productKey);
    const rewardDelta = nonNegativeInteger(submission.goldenBeans, 0);
    if (rewardDelta > 0) {
      award = submissionType === "phrase" && productKey
        ? await addCappedGoldenBeans({
            employeeId: submission.employeeId,
            sourceType: submissionType,
            sourceId: submissionId,
            productKey,
            delta: rewardDelta,
            reason: `审核通过：${submission.title}`,
            createdBy: "web-admin",
            productCap: 50
          })
        : await addGoldenBeansOnce({
            employeeId: submission.employeeId,
            sourceType: submissionType,
            sourceId: submissionId,
            delta: rewardDelta,
            reason: `审核通过：${submission.title}`,
            createdBy: "web-admin"
          });
    } else {
      award = { awarded: false, delta: 0 };
    }
  }

  return ok({
    alreadyReviewed: false,
    submissionId,
    status: decision,
    award
  });
}

async function deleteCasePost(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) {
    return secretError;
  }
  const caseId = requireString(payload.caseId, "caseId");
  const caseItem = await getFirst(collections.cases, { _id: caseId });
  if (!caseItem) {
    return fail("Case post not found", "CASE_NOT_FOUND");
  }

  await db.collection(collections.cases).doc(caseId).update({
    deletedAt: now(),
    deletedBy: "web-admin",
    updatedAt: now()
  });
  return ok({ caseId, deleted: true });
}

async function deleteCaseComment(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) {
    return secretError;
  }
  const commentId = requireString(payload.commentId, "commentId");
  const comment = await getFirst(collections.caseComments, { _id: commentId });
  if (!comment) {
    return fail("Case comment not found", "CASE_COMMENT_NOT_FOUND");
  }

  await db.collection(collections.caseComments).doc(commentId).update({
    deletedAt: now(),
    deletedBy: "web-admin",
    updatedAt: now()
  });
  return ok({ commentId, deleted: true });
}

async function saveCase(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) {
    return secretError;
  }

  try {
    assertAdminCasePrivacyConfirmation({ confirmed: payload.casePrivacyConfirmed, version: payload.casePrivacyVersion });
  } catch (error) {
    return fail(error.message, error.code);
  }

  const content = requireString(payload.content, "content");
  if (content.length > 2000) {
    return fail("案例内容不能超过 2000 字", "CASE_CONTENT_TOO_LONG");
  }

  const images = normalizeCaseImages({ images: payload.images });
  if (Array.isArray(payload.images) && payload.images.length > 9) {
    return fail("每条案例最多上传 9 张图片", "CASE_IMAGE_LIMIT");
  }
  const videoFileId = optionalString(payload.videoFileId)
    || (/^(cloud|cloudbase):\/\//i.test(optionalString(payload.videoUrl)) ? optionalString(payload.videoUrl) : "");
  const videoUrl = videoFileId ? "" : optionalString(payload.videoUrl);
  if (images.length > 0 && (videoFileId || videoUrl)) {
    return fail("一条案例请选择图片或视频其中一种", "CASE_MEDIA_CONFLICT");
  }

  const publisherEmployeeId = optionalString(payload.publisherEmployeeId || payload.employeeId);
  const publisher = publisherEmployeeId
    ? await getFirst(collections.employees, { _id: publisherEmployeeId, status: "active" })
    : null;
  if (publisherEmployeeId && (!publisher || publisher.role !== "admin")) {
    return fail("请选择有效的管理员账号", "CASE_PUBLISHER_INVALID");
  }

  const caseId = optionalString(payload.caseId || payload.id);
  const existing = caseId ? await getFirst(collections.cases, { _id: caseId }) : null;
  if (caseId && !existing) {
    return fail("案例不存在", "CASE_NOT_FOUND");
  }

  const updatedAt = now();
  const caseRecord = {
    type: "case",
    title: optionalString(payload.title) || (content.length > 24 ? `${content.slice(0, 24)}...` : content),
    content,
    images,
    videoFileId,
    videoUrl,
    videoDuration: Number(payload.videoDuration || 0),
    videoWidth: Number(payload.videoWidth || 0),
    videoHeight: Number(payload.videoHeight || 0),
    videoSize: Number(payload.videoSize || 0),
    employeeId: publisherEmployeeId,
    storeId: publisher?.storeId || "",
    regionId: publisher?.regionId || "",
    publisherName: "学习运营台",
    publisherRole: "admin",
    status: "approved",
    goldenBeans: 0,
    createdBy: "web-admin",
    reviewedBy: "web-admin",
    reviewedAt: existing?.reviewedAt || now(),
    casePrivacyConfirmed: true,
    casePrivacyVersion: CASE_PRIVACY_VERSION,
    productName: optionalString(payload.productName),
    visibleSupplierIds: Array.isArray(payload.visibleSupplierIds)
      ? payload.visibleSupplierIds.map((item) => optionalString(item)).filter(Boolean)
      : [],
    acknowledgementRequired: payload.acknowledgementRequired === true,
    casePrivacyConfirmedAt: updatedAt,
    updatedAt
  };

  let recipientRecords = [];
  let acknowledgementEmployees = [];
  if (caseRecord.acknowledgementRequired) {
    await ensureAdminCollection(collections.caseAcknowledgements);
    acknowledgementEmployees = await getCollection(collections.employees, 1000);
    const existingRecipients = caseId
      ? (await getOptionalCollectionRecords(collections.caseAcknowledgements, 5000)).filter((item) => optionalString(item.caseId) === caseId)
      : [];
    if (caseId && !existingRecipients.length) {
      recipientRecords = acknowledgementRecipientRecords({ caseId, employees: acknowledgementEmployees, createdAt: updatedAt });
    }
  }

  if (existing) {
    await db.runTransaction(async (transaction) => {
      await transaction.collection(collections.cases).doc(caseId).update(caseRecord);
      for (const recipient of recipientRecords) {
        const documentId = createHash("sha256").update(recipient.key).digest("hex").slice(0, 32);
        await transaction.collection(collections.caseAcknowledgements).doc(documentId).set(recipient);
      }
    });
    return ok({ caseId, case: { id: caseId, ...existing, ...caseRecord } });
  }

  const created = await db.runTransaction(async (transaction) => {
    const createdAt = updatedAt;
    const result = await transaction.collection(collections.cases).add({ ...caseRecord, createdAt });
    const recipients = caseRecord.acknowledgementRequired
      ? acknowledgementRecipientRecords({
        caseId: result.id,
        employees: acknowledgementEmployees,
        createdAt
      })
      : [];
    for (const recipient of recipients) {
      const documentId = createHash("sha256").update(recipient.key).digest("hex").slice(0, 32);
      await transaction.collection(collections.caseAcknowledgements).doc(documentId).set(recipient);
    }
    return { id: result.id, recipientCount: recipients.length };
  });
  return ok({ caseId: created.id, case: { id: created.id, ...caseRecord }, acknowledgementTargetCount: created.recipientCount });
}

async function saveCourse(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) {
    return secretError;
  }

  const courseId = optionalString(payload.courseId || payload.id);
  const course = normalizeCoursePayload(payload);
  if (publishedPptMissingSlides(course)) {
    return fail(course.pptProcessingStatus === "processing"
      ? "PPT 正在自动处理，请处理完成后再发布。"
      : "PPT 页面尚未生成，请重新上传 PPT 后等待自动处理完成。", "PPT_SLIDES_REQUIRED");
  }

  if (courseId) {
    const existingCourse = await getFirst(collections.courses, { _id: courseId });
    if (!existingCourse) {
      return fail("Course not found", "COURSE_NOT_FOUND");
    }

    await db.collection(collections.courses).doc(courseId).update(course);
    return ok({
      course: {
        id: courseId,
        ...course
      }
    });
  }

  const result = await db.collection(collections.courses).add({
    ...course,
    createdAt: now()
  });

  return ok({
    course: {
      id: result.id,
      ...course
    }
  });
}

async function savePhrase(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) {
    return secretError;
  }

  const phraseId = optionalString(payload.phraseId || payload.id);
  const phrase = normalizePhrasePayload(payload);

  if (phraseId) {
    const existingPhrase = await getFirst(collections.phrases, { _id: phraseId });
    if (!existingPhrase) {
      return fail("Phrase not found", "PHRASE_NOT_FOUND");
    }

    await db.collection(collections.phrases).doc(phraseId).update(phrase);
    return ok({ phrase: { id: phraseId, ...phrase } });
  }

  const result = await db.collection(collections.phrases).add({
    ...phrase,
    createdAt: now()
  });
  return ok({ phrase: { id: result.id, ...phrase } });
}

async function saveProductRewardRule(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) {
    return secretError;
  }

  const rule = normalizeProductRewardRulePayload(payload);
  const existingRule = await getFirst(collections.productRewardRules, { _id: rule.productKey });
  if (existingRule) {
    await db.collection(collections.productRewardRules).doc(rule.productKey).update(rule);
  } else {
    await db.collection(collections.productRewardRules).add({
      _id: rule.productKey,
      ...rule,
      createdAt: now()
    });
  }

  return ok({ rule: { id: rule.productKey, ...rule } });
}

async function deleteLearningContent(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) {
    return secretError;
  }

  const contentType = requireString(payload.contentType, "contentType");
  const contentId = requireString(payload.contentId, "contentId");
  const collectionName = {
    course: collections.courses,
    exam: collections.exams,
    phrase: collections.phrases
  }[contentType];

  if (!collectionName) {
    return fail("Unsupported learning content type", "INVALID_CONTENT_TYPE");
  }

  const existing = await getFirst(collectionName, { _id: contentId });
  if (!existing) {
    return fail("Learning content not found", "LEARNING_CONTENT_NOT_FOUND");
  }

  if (contentType === "exam") {
    const questionResult = await db.collection(collections.questions).where({ examId: contentId }).limit(1000).get();
    await Promise.all((questionResult.data || []).map((question) => (
      db.collection(collections.questions).doc(question._id).remove()
    )));
  }

  await db.collection(collectionName).doc(contentId).remove();
  return ok({ contentType, contentId, deleted: true });
}

async function saveExam(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) {
    return secretError;
  }

  const examId = optionalString(payload.examId || payload.id);
  const exam = normalizeExamPayload(payload);
  const questions = Array.isArray(payload.questions) ? payload.questions.map(normalizeQuestionPayload) : [];

  if (questions.length === 0) {
    return fail("Exam needs at least one question", "QUESTIONS_REQUIRED");
  }

  let nextExamId = examId;

  if (nextExamId) {
    const existingExam = await getFirst(collections.exams, { _id: nextExamId });
    if (!existingExam) {
      return fail("Exam not found", "EXAM_NOT_FOUND");
    }

    await db.collection(collections.exams).doc(nextExamId).update({
      ...exam,
      questionIds: questions.map((_, index) => `${nextExamId}-q-${String(index + 1).padStart(3, "0")}`)
    });
  } else {
    const result = await db.collection(collections.exams).add({
      ...exam,
      questionIds: [],
      createdAt: now()
    });
    nextExamId = result.id;
  }

  const existingQuestions = await db.collection(collections.questions).where({ examId: nextExamId }).limit(1000).get();
  await Promise.all((existingQuestions.data || []).map((question) => (
    db.collection(collections.questions).doc(question._id).remove()
  )));

  const questionIds = [];
  for (let index = 0; index < questions.length; index += 1) {
    const questionId = `${nextExamId}-q-${String(index + 1).padStart(3, "0")}`;
    questionIds.push(questionId);
    await db.collection(collections.questions).add({
      _id: questionId,
      examId: nextExamId,
      ...questions[index],
      createdAt: now()
    });
  }

  await db.collection(collections.exams).doc(nextExamId).update({
    questionIds
  });

  return ok({
    exam: {
      id: nextExamId,
      ...exam,
      questionCount: questions.length,
      questionIds
    }
  });
}

async function startPptConversion(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) return secretError;

  const sourceFileId = requireString(payload.fileId || payload.resourceUrl, "fileId");
  const source = await pptCosLocation(sourceFileId);
  if (!/\.pptx?$/i.test(source.key)) {
    return fail("请选择 .ppt 或 .pptx 文件", "PPT_FILE_REQUIRED");
  }

  const cos = pptCosClient();
  const outputPrefix = buildOutputPrefix(source.key);
  const host = `${source.bucket}.ci.${source.region}.myqcloud.com`;
  const requestBody = COS.util.json2xml({
    Request: {
      Tag: "DocProcess",
      Input: { Object: source.key },
      Operation: {
        DocProcess: { TgtType: "jpg" },
        Output: {
          Bucket: source.bucket,
          Region: source.region,
          Object: `${outputPrefix}\${Number}.jpg`
        }
      }
    }
  });

  let response;
  try {
    response = await cosRequest(cos, {
      Bucket: source.bucket,
      Region: source.region,
      Method: "POST",
      Key: "doc_jobs",
      Url: `https://${host}/doc_jobs`,
      Body: requestBody,
      ContentType: "application/xml"
    });
  } catch (error) {
    console.error("[adminData-ppt-start]", error);
    return fail("PPT 文件已上传，但当前存储桶尚未开通数据万象文档处理，或 adminData 云函数没有文档转换权限。请先在腾讯云数据万象开通文档处理并授权后再重试。", "PPT_CONVERSION_UNAVAILABLE");
  }

  const jobId = parseCreatedJob(response);
  const record = {
    _id: jobId,
    jobId,
    sourceFileId,
    cloudAuthority: source.authority,
    bucket: source.bucket,
    region: source.region,
    outputPrefix,
    status: "processing",
    createdAt: now(),
    updatedAt: now()
  };
  await addDocument(collections.pptConversionJobs, record);
  return ok({ jobId, status: "processing" });
}

async function getPptConversionStatus(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) return secretError;

  const jobId = requireString(payload.jobId, "jobId");
  const record = await getFirst(collections.pptConversionJobs, { _id: jobId });
  if (!record) return fail("没有找到 PPT 处理任务，请重新上传", "PPT_CONVERSION_NOT_FOUND");
  if (record.status === "ready" && Array.isArray(record.slideImageFileIds) && record.slideImageFileIds.length > 0) {
    return ok({
      jobId,
      status: "ready",
      slideCount: record.slideImageFileIds.length,
      slideImageFileIds: record.slideImageFileIds
    });
  }

  const cos = pptCosClient();
  const host = `${record.bucket}.ci.${record.region}.myqcloud.com`;
  let response;
  try {
    response = await cosRequest(cos, {
      Bucket: record.bucket,
      Region: record.region,
      Method: "GET",
      Key: `doc_jobs/${jobId}`,
      Url: `https://${host}/doc_jobs/${encodeURIComponent(jobId)}`
    });
  } catch (error) {
    console.error("[adminData-ppt-status]", error);
    return fail("暂时无法查询 PPT 处理进度，请稍后重试", "PPT_CONVERSION_STATUS_UNAVAILABLE");
  }

  const result = parseJobResult(response);
  if (result.state === "failed") {
    await db.collection(collections.pptConversionJobs).doc(record._id).update({
      status: "failed",
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      updatedAt: now()
    });
    return ok({
      jobId,
      status: "failed",
      message: result.errorMessage || "PPT 文件无法转换，请重新导出为 .pptx 后上传"
    });
  }
  if (result.state !== "ready") return ok({ jobId, status: "processing" });

  const slideKeys = await listPptSlideKeys(cos, record.bucket, record.region, record.outputPrefix);
  if (slideKeys.length === 0) return ok({ jobId, status: "processing" });
  const slideImageFileIds = slideKeys.map((key) => buildCloudFileId(record.cloudAuthority, key));
  await db.collection(collections.pptConversionJobs).doc(record._id).update({
    status: "ready",
    slideCount: slideImageFileIds.length,
    slideImageFileIds,
    updatedAt: now()
  });
  return ok({
    jobId,
    status: "ready",
    slideCount: slideImageFileIds.length,
    slideImageFileIds
  });
}

async function uploadCourseAsset(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) {
    return secretError;
  }

  const file = payload.file;
  if (!file?.content || !Buffer.isBuffer(file.content) || file.content.length === 0) {
    return fail("请选择要上传的文件", "FILE_REQUIRED");
  }

  const extension = extensionFromFile(file);
  const folder = safeFolderName(payload.folder);
  const cloudPath = assetCloudPath(folder, extension);
  const uploadResult = await app.uploadFile({
    cloudPath,
    fileContent: file.content
  });

  return ok({
    fileID: uploadResult.fileID,
    url: uploadResult.fileID,
    cloudPath,
    size: file.content.length,
    contentType: file.contentType
  });
}

async function createCourseAssetUpload(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) {
    return secretError;
  }

  const filename = optionalString(payload.filename) || "asset.dat";
  const contentType = optionalString(payload.contentType) || "application/octet-stream";
  const size = Number(payload.size || 0);
  if (!Number.isFinite(size) || size <= 0) {
    return fail("上传文件大小无效", "INVALID_FILE_SIZE");
  }
  if (size > 2 * 1024 * 1024 * 1024) {
    return fail("上传文件不能超过 2GB", "FILE_TOO_LARGE");
  }

  const folder = safeFolderName(payload.folder);
  const extension = extensionFromFile({ filename, contentType });
  const cloudPath = assetCloudPath(folder, extension);
  const metadataResult = await app.getUploadMetadata({ cloudPath });
  const metadata = metadataResult?.data || {};
  if (!metadata.url || !metadata.authorization || !metadata.token || !metadata.fileId || !metadata.cosFileId) {
    return fail("无法获取云存储上传地址，请稍后重试", "UPLOAD_METADATA_UNAVAILABLE");
  }

  return ok({
    uploadUrl: metadata.url,
    authorization: metadata.authorization,
    token: metadata.token,
    cosFileId: metadata.cosFileId,
    fileID: metadata.fileId,
    url: metadata.fileId,
    cloudPath,
    size,
    contentType
  });
}

async function uploadCourseAssetChunk(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) {
    return secretError;
  }

  const file = payload.file;
  if (!file?.content || !Buffer.isBuffer(file.content) || file.content.length === 0) {
    return fail("请选择要上传的分片", "FILE_REQUIRED");
  }

  const folder = safeFolderName(payload.folder);
  const uploadId = safeUploadId(payload.uploadId);
  const chunkIndex = Number(payload.chunkIndex || 0);
  if (!Number.isFinite(chunkIndex) || chunkIndex < 0) {
    return fail("分片序号无效", "INVALID_CHUNK_INDEX");
  }

  const cloudPath = `${folder}/chunks/${uploadId}/${String(chunkIndex).padStart(5, "0")}.part`;
  const uploadResult = await app.uploadFile({
    cloudPath,
    fileContent: file.content
  });

  return ok({
    fileID: uploadResult.fileID,
    cloudPath,
    uploadId,
    chunkIndex,
    size: file.content.length
  });
}

async function completeCourseAssetUpload(payload) {
  const secretError = requireAdminSecret(payload.secret);
  if (secretError) {
    return secretError;
  }

  const folder = safeFolderName(payload.folder);
  const filename = optionalString(payload.filename) || "asset.dat";
  const contentType = optionalString(payload.contentType) || "application/octet-stream";
  const chunks = Array.isArray(payload.chunks) ? payload.chunks : [];
  if (chunks.length === 0) {
    return fail("缺少上传分片", "CHUNKS_REQUIRED");
  }

  const sortedChunks = chunks
    .map((chunk) => ({
      fileID: optionalString(chunk.fileID),
      chunkIndex: Number(chunk.chunkIndex || 0)
    }))
    .filter((chunk) => chunk.fileID && Number.isFinite(chunk.chunkIndex))
    .sort((a, b) => a.chunkIndex - b.chunkIndex);

  if (sortedChunks.length !== chunks.length) {
    return fail("分片数据不完整", "INVALID_CHUNKS");
  }

  const buffers = [];
  for (const chunk of sortedChunks) {
    buffers.push(await fetchCloudFileBuffer(chunk.fileID));
  }

  const fileContent = Buffer.concat(buffers);
  const extension = extensionFromFile({ filename, contentType });
  const cloudPath = assetCloudPath(folder, extension);
  const uploadResult = await app.uploadFile({
    cloudPath,
    fileContent
  });

  await cleanupChunkFiles(sortedChunks.map((chunk) => chunk.fileID));

  return ok({
    fileID: uploadResult.fileID,
    url: uploadResult.fileID,
    cloudPath,
    size: fileContent.length,
    contentType
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(req, res, {}, 204);
    return;
  }

  try {
    const providedSecret = bearerSecret(req.headers.authorization);
    assertAdminSecret({
      configuredSecret: reviewSecret,
      providedSecret
    });
    if (req.method === "GET") {
      sendJson(req, res, ok(await loadAdminData()));
      return;
    }

    if (req.method === "POST") {
      const payload = await readPayload(req);
      payload.secret = providedSecret;
      let result;
      if (payload.action === "saveCourse") {
        result = await saveCourse(payload);
      } else if (payload.action === "savePhrase") {
        result = await savePhrase(payload);
      } else if (payload.action === "saveExam") {
        result = await saveExam(payload);
      } else if (payload.action === "saveProductRewardRule") {
        result = await saveProductRewardRule(payload);
      } else if (payload.action === "importEmployeeProductTasks") {
        result = await importEmployeeProductTasks(payload);
      } else if (payload.action === "importStoreProductSales") {
        result = await importStoreProductSales(payload);
      } else if (payload.action === "setUniformStoreProductSalesTarget") {
        result = await setUniformStoreProductSalesTarget(payload);
      } else if (payload.action === "saveStoreTaskReward") {
        result = await saveStoreTaskReward(payload);
      } else if (payload.action === "setUniformProductTask") {
        result = await setUniformProductTask(payload);
      } else if (payload.action === "clearUniformProductTask") {
        result = await clearUniformProductTask(payload);
      } else if (payload.action === "clearStoreProductSales") {
        result = await clearStoreProductSales(payload);
      } else if (payload.action === "enforceNinetyPointExamRule") {
        result = await enforceNinetyPointExamRule(payload);
      } else if (payload.action === "deleteLearningContent") {
        result = await deleteLearningContent(payload);
      } else if (payload.action === "startPptConversion") {
        result = await startPptConversion(payload);
      } else if (payload.action === "getPptConversionStatus") {
        result = await getPptConversionStatus(payload);
      } else if (payload.action === "createCourseAssetUpload") {
        result = await createCourseAssetUpload(payload);
      } else if (payload.action === "uploadCourseAsset") {
        result = await uploadCourseAsset(payload);
      } else if (payload.action === "uploadCourseAssetChunk") {
        result = await uploadCourseAssetChunk(payload);
      } else if (payload.action === "completeCourseAssetUpload") {
        result = await completeCourseAssetUpload(payload);
      } else if (payload.action === "saveStore") {
        result = await saveStore(payload);
      } else if (payload.action === "saveEmployee") {
        result = await saveEmployee(payload);
      } else if (payload.action === "importEmployees") {
        result = await importEmployees(payload);
      } else if (payload.action === "cleanupLegacyDuplicateEmployees") {
        result = await cleanupLegacyDuplicateEmployees(payload);
      } else if (payload.action === "reviewEmployeeApplication") {
        result = await reviewEmployeeApplicationAction(payload);
      } else if (payload.action === "reviewStoreReceipt") {
        result = await reviewStoreReceipt(payload);
      } else if (payload.action === "unbindEmployeeWechat") {
        result = await unbindEmployeeWechat(payload);
      } else if (payload.action === "resetEmployeeGoldenBeans") {
        result = await resetEmployeeGoldenBeans(payload);
      } else if (payload.action === "resetEmployeeLearningProgress") {
        result = await resetEmployeeLearningProgress(payload);
      } else if (payload.action === "saveTaskRewards") {
        result = await saveTaskRewards(payload);
      } else if (payload.action === "saveReward") {
        result = await saveReward(payload);
      } else if (payload.action === "fulfillRedemption") {
        result = await fulfillRedemption(payload);
      } else if (payload.action === "adjustGoldenBeans") {
        result = await adjustGoldenBeans(payload);
      } else if (payload.action === "saveCase") {
        result = await saveCase(payload);
      } else if (payload.action === "deleteCasePost") {
        result = await deleteCasePost(payload);
      } else if (payload.action === "deleteCaseComment") {
        result = await deleteCaseComment(payload);
      } else {
        result = await reviewSubmission(payload);
      }
      sendJson(req, res, result, result.ok ? 200 : 400);
      return;
    }

    sendJson(req, res, fail("Only GET and POST requests are supported", "METHOD_NOT_ALLOWED"), 405);
  } catch (error) {
    const statusCode = error.code === "ADMIN_UNAUTHORIZED" ? 401 : error.code === "ADMIN_SECRET_REQUIRED" ? 503 : 500;
    sendJson(req, res, fail(error.message, error.code || "ADMIN_DATA_FAILED"), statusCode);
  }
});

server.listen(9000, "0.0.0.0", () => {
  console.log("adminData HTTP function listening on port 9000");
});
