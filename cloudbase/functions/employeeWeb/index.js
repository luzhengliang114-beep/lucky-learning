const { createHash, randomBytes } = require("node:crypto");
const { createServer } = require("node:http");
const {
  addCappedGoldenBeans,
  app,
  command,
  db,
  fail,
  getFirst,
  now,
  ok,
  requireString
} = require("./_shared/db");
const {
  MAX_EXAM_ATTEMPTS,
  chunkCloudFileIds,
  configuredSubmissionReward,
  examAttemptsRemaining,
  isPrivateReceiptUploadFolder,
  learningCompletionRate,
  normalizeCaseMedia,
  parseMediaDataUrl,
  phraseCompletionCount,
  visibleCasePosts,
  voiceFormatForContentType,
  wavDurationSeconds
} = require("./core");
const { courseProgressPercent, learningMetricsForEmployee, learningProductDetails } = require("./_shared/learningMetrics");
const {
  acknowledgeRecipient,
  acknowledgementCounts,
  caseAcknowledgementState,
  isLegacyAdminNotice,
  isAcknowledgementCase,
  missingAcknowledgementRecipientRecords,
  notificationSummaryForEmployee,
  writableAcknowledgementRecord
} = require("./_shared/caseAcknowledgements");
const {
  assertImageSafe,
  assertTextSafe
} = require("./contentSecurity");
const {
  isAllowlistedEmployee,
  resolveDirectLoginEmployee
} = require("./directLoginCore");
const {
  CASE_PRIVACY_VERSION,
  EMPLOYEE_NOTICE_VERSION,
  RECORDING_NOTICE_VERSION,
  approvePendingApplicationForKnownEmployee,
  assertCasePrivacyConfirmation,
  assertEmployeeNotice,
  assertRecordingNotice,
  filterEligibleRewards,
  openIdHashFor,
  prepareApplicationSubmission,
  publicApplicationSummary,
  resolveRegistrationStore,
} = require("./employeeRegistrationCore");
const {
  createSessionSecretManager,
  isCollectionAlreadyExistsError
} = require("./sessionSecretCore");
const {
  MANUAL_REVIEW_MODE,
  createManualIdentity,
  isManualIdentity,
  normalizeEmployeeLoginMode,
  shouldRunWechatContentSecurity
} = require("./manualReviewCore");
const { compareSpeechText, recognizeAudio } = require("./speech");
const {
  canCountStoreReceipt,
  normalizeReceiptText,
  normalizeReceiptResult,
  receiptFingerprint
} = require("./_shared/storeReceiptCore");
const { recognizeReceipt } = require("./receiptOcr");
const { phraseAttemptLimit } = require("./_shared/rewardRules");
const {
  buildEmployeeProductStatuses,
  currentPeriodKey,
  taskForProduct,
  taskStatus
} = require("./_shared/productTasks");
const {
  allowedProductKeys,
  canViewCase,
  canViewProduct,
  filterSupplierData,
  isSupplier
} = require("./_shared/supplierAccess");
const {
  completePptSlide,
  normalizePptProgress,
  startPptSlide
} = require("./pptProgressCore");
const {
  canCompleteVideo,
  normalizeVideoProgress,
  updateVideoProgress
} = require("./videoProgressCore");
const { buildProductTaskRankings } = require("./productTaskRankingCore");
const {
  buildStoreProductRankings,
  storeDisplayName
} = require("./_shared/storeProductSales");
const {
  buildStoreTaskRewardOffers,
  buildStoreTaskRewardClaimId,
  calculateStoreTaskRewardQuota,
  normalizeStoreTaskReward
} = require("./_shared/storeTaskReward");
const {
  productGoldenBeansByEmployee,
  supplierProductTaskRankings
} = require("./supplierRankingCore");
const { buildLearningTodos } = require("./_shared/learningTodos");
const { resolveExamAttemptCycle } = require("./examAttemptCycleCore");
const { evaluateProductLearningPrerequisite } = require("./productLearningPrerequisiteCore");
const {
  courseLearningCompleted,
  courseProgressByCourseId,
  progressForEmployee
} = require("./courseProgressSummaryCore");

const oaAppId = process.env.WECHAT_OA_APPID || "";
const oaAppSecret = process.env.WECHAT_OA_APP_SECRET || "";
const oauthRedirectUri = process.env.WECHAT_OAUTH_REDIRECT_URI || "";
const identityHashSecret = process.env.EMPLOYEE_IDENTITY_HASH_SECRET || "";
const privacyContact = process.env.PRIVACY_CONTACT || "";
const allowDirectLogin = String(process.env.ALLOW_DIRECT_LOGIN || "").toLowerCase() === "true";
const employeeLoginMode = normalizeEmployeeLoginMode(process.env.EMPLOYEE_LOGIN_MODE);
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const maxUploadBytes = 32 * 1024 * 1024;
const maxSpeechBytes = 3 * 1024 * 1024;
const maxReceiptBytes = 8 * 1024 * 1024;
const sessionSecretManager = createSessionSecretManager({
  db,
  envSecret: process.env.WEB_SESSION_SECRET || "",
  now,
  sessionTtlMs
});

const collectionByType = {
  phrase: "phraseSubmissions",
  case: "cases"
};

const defaultSubmissionRewards = {
  phrase: 0,
  case: 0
};

function optionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function requestClientContext(payload = {}) {
  const context = payload.clientContext && typeof payload.clientContext === "object"
    ? payload.clientContext
    : {};
  const allowedPlatforms = new Set(["ios", "android", "harmony", "other"]);
  const platform = optionalString(context.platform).toLowerCase();
  return {
    platform: allowedPlatforms.has(platform) ? platform : "other",
    runtime: optionalString(context.runtime).slice(0, 24),
    runtimeVersion: optionalString(context.runtimeVersion).slice(0, 32)
  };
}

function idValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    if (typeof value.toHexString === "function") return value.toHexString();
    if (typeof value.$oid === "string") return value.$oid.trim();
    if (typeof value.id === "string") return value.id.trim();
    if (typeof value._id === "string") return value._id.trim();
  }
  return String(value).trim();
}

function normalizeId(item = {}) {
  const { _id, inviteCode, ...rest } = item;
  return { ...rest, id: idValue(item.id || _id) };
}

function isCloudFileId(value) {
  const raw = optionalString(value);
  return raw.startsWith("cloud://") || raw.startsWith("cloudbase://");
}

function isMissingCollectionError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return code === "DATABASE_COLLECTION_NOT_EXIST" || /Db or Table not exist|collection not exist|table not exist/i.test(message);
}

function publicFileUrl(value, tempUrls = {}) {
  const raw = optionalString(value);
  if (!raw) return "";
  return isCloudFileId(raw) ? tempUrls[raw] || "" : raw;
}

function sendJson(req, res, body, statusCode = 200, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Accept, Authorization",
    "access-control-max-age": "86400",
    vary: "Origin",
    ...extraHeaders
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxUploadBytes * 2) {
        reject(new Error("请求内容过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("请求格式不正确"));
      }
    });
    req.on("error", reject);
  });
}

async function getCollection(collectionName, limit = 1000) {
  const result = await db.collection(collectionName).limit(limit).get();
  return result.data || [];
}

async function getOptionalCollection(collectionName, limit = 1000) {
  try {
    return await getCollection(collectionName, limit);
  } catch (error) {
    if (isMissingCollectionError(error)) return [];
    throw error;
  }
}

async function getOptionalCollectionWhere(collectionName, filter, limit = 1000) {
  try {
    const result = await db.collection(collectionName).where(filter).limit(limit).get();
    return result.data || [];
  } catch (error) {
    if (isMissingCollectionError(error)) return [];
    throw error;
  }
}

async function getOptionalFirst(collectionName, filter) {
  try {
    return await getFirst(collectionName, filter);
  } catch (error) {
    if (isMissingCollectionError(error)) return null;
    throw error;
  }
}

function policyMetadata() {
  return {
    employeeNoticeVersion: EMPLOYEE_NOTICE_VERSION,
    recordingNoticeVersion: RECORDING_NOTICE_VERSION,
    casePrivacyVersion: CASE_PRIVACY_VERSION,
    privacyContact: privacyContact || "请联系培训管理员"
  };
}

async function latestApplicationForOpenId(openId) {
  const openIdHash = openIdHashFor(openId, identityHashSecret);
  const applications = await getOptionalCollection("employeeApplications");
  const application = applications
    .filter((item) => item.openIdHash === openIdHash)
    .sort((left, right) => String(right.submittedAt || right.createdAt || "").localeCompare(String(left.submittedAt || left.createdAt || "")))[0] || null;
  return { openIdHash, applications, application };
}

async function ensureCollectionExists(collectionName) {
  try {
    await db.createCollection(collectionName);
  } catch (error) {
    if (!isCollectionAlreadyExistsError(error)) throw error;
  }
}

async function updateEmployeeApplicationDocument(application) {
  const applicationId = application?._id || application?.id;
  if (!applicationId) {
    const error = new Error("员工申请记录无效");
    error.code = "EMPLOYEE_APPLICATION_INVALID";
    throw error;
  }
  const { _id, id, ...document } = application;
  await db.collection("employeeApplications").doc(applicationId).update(document);
}

async function finalizePendingApplicationForKnownEmployee({ session, employee, noticeVersion }) {
  const { openIdHash, application } = await latestApplicationForOpenId(session.openId);
  if (!application || application.status !== "pending") return;
  const approved = approvePendingApplicationForKnownEmployee({
    application,
    openIdHash,
    employee,
    noticeVersion: noticeVersion || application.noticeVersion,
    now
  });
  await updateEmployeeApplicationDocument(approved);
  await db.collection("webSessions").doc(session._id).update({
    applicationId: approved._id || approved.id,
    updatedAt: now()
  });
}

async function addDocument(collectionName, payload, transaction = null) {
  const collection = transaction ? transaction.collection(collectionName) : db.collection(collectionName);
  try {
    return await collection.add(payload);
  } catch (error) {
    if (!isMissingCollectionError(error)) throw error;
    await ensureCollectionExists(collectionName);
    const retryCollection = transaction ? transaction.collection(collectionName) : db.collection(collectionName);
    return retryCollection.add(payload);
  }
}

async function getTaskRewards() {
  try {
    const rewards = await getCollection("taskRewards");
    return rewards.reduce((next, item) => ({
      ...next,
      [item.id || item._id]: Number(item.goldenBeans)
    }), { ...defaultSubmissionRewards });
  } catch {
    return { ...defaultSubmissionRewards };
  }
}

async function requireOwnedMedia(employeeId, fileIds, expectedPrefix) {
  const uniqueIds = [...new Set(fileIds.filter(Boolean))];
  const records = await Promise.all(uniqueIds.map((fileId) => getOptionalFirst("webMediaUploads", { employeeId, fileId })));
  if (records.some((record) => !record || !String(record.contentType || "").startsWith(expectedPrefix))) {
    const error = new Error("上传文件无效或不属于当前员工");
    error.code = "MEDIA_OWNERSHIP_INVALID";
    throw error;
  }
  return records;
}

async function getTempFileURLs(fileIds = []) {
  const batches = chunkCloudFileIds(fileIds);
  if (batches.length === 0) return {};
  const results = await Promise.all(batches.map(async (fileList, batchIndex) => {
    try {
      return await app.getTempFileURL({ fileList });
    } catch (error) {
      console.error(`[employeeWeb-temp-url:${batchIndex + 1}/${batches.length}]`, error.message);
      return { fileList: [] };
    }
  }));
  return results.flatMap((result) => result.fileList || []).reduce((map, item) => {
    if (item.fileID && item.tempFileURL) map[item.fileID] = item.tempFileURL;
    return map;
  }, {});
}

async function resolveAsset(value) {
  const raw = optionalString(value);
  if (!isCloudFileId(raw)) return raw;
  const urls = await getTempFileURLs([raw]);
  return urls[raw] || "";
}

function sessionHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function configuredRedirect(redirectUri = "") {
  const requested = optionalString(redirectUri);
  if (!oauthRedirectUri) {
    const error = new Error("请先在公众号后台配置网页授权回调地址，并在 employeeWeb 配置 WECHAT_OAUTH_REDIRECT_URI");
    error.code = "WECHAT_OAUTH_REDIRECT_REQUIRED";
    throw error;
  }
  if (requested && requested !== oauthRedirectUri) {
    const error = new Error("网页授权回调地址与云函数配置不一致");
    error.code = "WECHAT_OAUTH_REDIRECT_MISMATCH";
    throw error;
  }
  return oauthRedirectUri;
}

async function exchangeOfficialCode(code) {
  if (!oaAppId || !oaAppSecret) {
    const error = new Error("请在 employeeWeb 云函数配置微信公众号 AppID 和 AppSecret");
    error.code = "WECHAT_OA_CONFIG_REQUIRED";
    throw error;
  }
  const url = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
  url.searchParams.set("appid", oaAppId);
  url.searchParams.set("secret", oaAppSecret);
  url.searchParams.set("code", requireString(code, "code"));
  url.searchParams.set("grant_type", "authorization_code");
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || !body.openid) {
    const error = new Error(body.errmsg || "微信网页授权失败");
    error.code = `WECHAT_OA_${body.errcode || "NO_OPENID"}`;
    throw error;
  }
  return {
    openId: body.openid,
    accessToken: body.access_token,
    expiresIn: Number(body.expires_in || 0)
  };
}

async function fetchOfficialUserInfo(accessToken, openId) {
  const url = new URL("https://api.weixin.qq.com/sns/userinfo");
  url.searchParams.set("access_token", requireString(accessToken, "access_token"));
  url.searchParams.set("openid", requireString(openId, "openid"));
  url.searchParams.set("lang", "zh_CN");
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || body.errcode || !body.openid) {
    const error = new Error(body.errmsg || "微信用户信息读取失败");
    error.code = `WECHAT_USERINFO_${body.errcode || "INVALID_RESPONSE"}`;
    throw error;
  }
  return {
    nickname: optionalString(body.nickname),
    avatarUrl: optionalString(body.headimgurl).replace(/^http:\/\//i, "https://")
  };
}

async function createSession(openId, employeeId = "", wechatProfile = {}) {
  return sessionSecretManager.createSession(openId, employeeId, wechatProfile);
}

function userIdForOpenId(openId) {
  return `user-${createHash("sha256").update(String(openId || "")).digest("hex").slice(0, 20)}`;
}

async function bindKnownEmployee({ session, employee, stores }) {
  const employeeId = employee._id || employee.id;
  if (!employeeId) {
    const error = new Error("员工名单资料无效，请联系总部管理员");
    error.code = "EMPLOYEE_ALLOWLIST_INVALID";
    throw error;
  }

  if (!isManualIdentity(session.openId)) {
    const employeeUsers = await db.collection("users").where({ employeeId, status: "active" }).limit(100).get();
    const conflictingUser = (employeeUsers.data || []).find((user) => user.openId && user.openId !== session.openId);
    if (conflictingUser) {
      const error = new Error("该员工已经绑定其他微信，请联系管理员处理");
      error.code = "EMPLOYEE_WECHAT_ALREADY_BOUND";
      throw error;
    }
    const existingUser = await getFirst("users", { openId: session.openId });
    await db.collection("users").doc(existingUser?._id || userIdForOpenId(session.openId)).set({
      openId: session.openId,
      employeeId,
      role: employee.role || "employee",
      status: "active",
      createdAt: existingUser?.createdAt || now(),
      updatedAt: now()
    });
  }

  await db.collection("webSessions").doc(session._id).update({ employeeId, updatedAt: now() });
  if (session.wechatAvatarUrl || session.wechatNickname) {
    await db.collection("employees").doc(employeeId).update({
      ...(session.wechatAvatarUrl ? { wechatAvatarUrl: session.wechatAvatarUrl } : {}),
      ...(session.wechatNickname ? { wechatNickname: session.wechatNickname } : {}),
      updatedAt: now()
    });
  }
  const refreshed = await getFirst("employees", { _id: employeeId, status: "active" });
  return ok({
    bound: true,
    employee: await publicEmployee(refreshed || employee, stores),
    applicationStatus: "approved",
    application: null,
    bypassReview: true,
    policy: policyMetadata()
  });
}

async function getSession(payload) {
  const token = optionalString(payload.sessionToken);
  if (!token) {
    const error = new Error("登录状态已失效，请重新进入");
    error.code = "WEB_SESSION_REQUIRED";
    throw error;
  }
  const session = await getFirst("webSessions", { tokenHash: sessionHash(token), status: "active" });
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
    const error = new Error("登录状态已失效，请重新授权");
    error.code = "WEB_SESSION_EXPIRED";
    throw error;
  }
  return session;
}

async function getBoundContext(payload) {
  const session = await getSession(payload);
  if (!session.employeeId) {
    const error = new Error("总部员工名单中未找到该员工，请联系总部管理员录入。");
    error.code = "EMPLOYEE_ALLOWLIST_REQUIRED";
    throw error;
  }
  const employee = await getFirst("employees", { _id: session.employeeId, status: "active" });
  if (!employee || !isAllowlistedEmployee(employee)) {
    const error = new Error("员工资料不存在，请联系管理员");
    error.code = "EMPLOYEE_ACCOUNT_INVALID";
    throw error;
  }
  return { session, employee };
}

async function getStores() {
  return (await getCollection("stores")).filter((item) => item.status !== "inactive").map(normalizeId);
}

async function getPublishedCourseById(courseId) {
  const key = idValue(courseId);
  if (!key) return null;

  const direct = await getOptionalFirst("courses", { _id: key, status: "published" });
  if (direct) return direct;

  // Older imported courses can have BSON ObjectId values while the web client
  // sends the normalized hex string. Resolve by normalized ID without changing
  // the stored course documents.
  const courses = await getCollection("courses");
  return courses.find((course) => (
    course.status === "published"
    && idValue(course.id || course._id) === key
  )) || null;
}

async function entryDataAction() {
  return ok({
    stores: await getStores()
  });
}

async function publicEmployee(employee, stores) {
  const rawAvatar = optionalString(employee.wechatAvatarUrl || employee.avatarUrl || employee.avatarFileId);
  const avatarUrls = await getTempFileURLs([rawAvatar]);
  const store = stores.find((item) => item.id === employee.storeId || item._id === employee.storeId);
  return {
    ...normalizeId(employee),
    store: storeDisplayName(store),
    avatarFileId: isCloudFileId(employee.avatarFileId) ? employee.avatarFileId : "",
    avatarUrl: publicFileUrl(rawAvatar, avatarUrls)
  };
}

function productKey(item = {}) {
  return optionalString(item.productId || item.productName || item.productKey || item.title);
}

const supplierCanViewProduct = canViewProduct;
const supplierCanViewCase = canViewCase;

function assertSupplierReadOnly(employee = {}) {
  if (employee.role === "supplier") {
    return fail("供应商账号仅可查看总部授权产品的学习数据，不能提交学习、考试、录音、案例、兑换或修改数据", "SUPPLIER_READ_ONLY");
  }
  return null;
}

async function productRewardCap(key) {
  if (!key) return 50;
  const rules = await getCollection("productRewardRules").catch(() => []);
  const rule = rules.find((item) => item.status !== "inactive" && (item.productKey === key || item.productName === key));
  return Number.isFinite(Number(rule?.rewardCap)) ? Number(rule.rewardCap) : 50;
}

async function publicCourses(courses) {
  const fileIds = courses.flatMap((course) => [
    course.productImage || course.productImageUrl,
    course.coverImage || course.coverImageUrl,
    ...(Array.isArray(course.slideImageFileIds) ? course.slideImageFileIds : [])
  ]);
  const tempUrls = await getTempFileURLs(fileIds);
  return courses.map((course) => {
    const videoFileId = optionalString(course.videoFileId) || (isCloudFileId(course.videoUrl) ? course.videoUrl : "");
    return {
      ...normalizeId(course),
      productImageUrl: publicFileUrl(course.productImage || course.productImageUrl, tempUrls),
      coverImageUrl: publicFileUrl(course.coverImage || course.coverImageUrl, tempUrls),
      slideImageUrls: Array.isArray(course.slideImageFileIds)
        ? course.slideImageFileIds.map((fileId) => publicFileUrl(fileId, tempUrls)).filter(Boolean)
        : [],
      hasVideo: Boolean(videoFileId || optionalString(course.videoUrl)),
      videoUrl: "",
      videoFileId: ""
    };
  });
}

function acknowledgementDocumentId(key) {
  return createHash("sha256").update(String(key || "")).digest("hex").slice(0, 32);
}

async function ensureCaseAcknowledgementRecords({ cases = [], employees = [], recipients = [] } = {}) {
  const missing = missingAcknowledgementRecipientRecords({ cases, employees, recipients });
  if (!missing.length) return recipients;
  await ensureCollectionExists("caseAcknowledgements");
  const created = [];
  for (let offset = 0; offset < missing.length; offset += 20) {
    const batch = missing.slice(offset, offset + 20);
    const saved = await Promise.all(batch.map(async (record) => {
      const documentId = acknowledgementDocumentId(record.key);
      // CloudBase reserves `_id` as the document key; it must not be repeated
      // inside the object passed to set(), otherwise old notices fail with
      // "不能更新_id的值".
      await db.collection("caseAcknowledgements").doc(documentId).set(writableAcknowledgementRecord(record));
      return { _id: documentId, ...record };
    }));
    created.push(...saved);
  }
  return [...recipients, ...created];
}

async function publicCases(cases, comments = [], employees = [], stores = [], recipients = [], viewer = {}) {
  const fileIds = cases.flatMap((item) => {
    const images = Array.isArray(item.images) ? item.images : [];
    return [
      ...images.map((image) => image.fileId || image.fileID),
      item.videoFileId || (isCloudFileId(item.videoUrl) ? item.videoUrl : "")
    ];
  });
  const tempUrls = await getTempFileURLs(fileIds);
  return Promise.all(cases.map(async (item) => {
    const employee = item.employeeId ? employees.find((candidate) => candidate._id === item.employeeId || candidate.id === item.employeeId) : null;
    const publisherStore = stores.find((store) => {
      const storeId = employee?.storeId || item.storeId;
      return store._id === storeId || store.id === storeId;
    });
    const publisher = employee?.name || item.publisherName || "门店员工";
    const itemComments = comments.filter((comment) => comment.caseId === (item._id || item.id)).map((comment) => {
      const author = employees.find((candidate) => candidate._id === comment.employeeId || candidate.id === comment.employeeId);
      return {
        id: comment._id || comment.id,
        employeeId: comment.employeeId,
        employeeName: author?.name || "门店员工",
        content: optionalString(comment.content),
        createdAt: comment.createdAt
      };
    });
    return {
      ...normalizeId(item),
      ...caseAcknowledgementState({ item, employeeId: viewer.employeeId, employeeRole: viewer.employeeRole, recipients }),
      ...(isLegacyAdminNotice(item) ? { acknowledgementRequired: true } : {}),
      ...(viewer.isAdmin ? acknowledgementCounts(item, recipients) : {}),
      publisherName: publisher,
      publisherRole: item.publisherRole || "employee",
      publisherStore: publisherStore?.name || "",
      images: (Array.isArray(item.images) ? item.images : []).map((image) => ({
        ...image,
        url: publicFileUrl(image.fileId || image.fileID || image.url, tempUrls)
      })).filter((image) => image.url),
      videoUrl: publicFileUrl(item.videoFileId || item.videoUrl, tempUrls),
      publisherAvatar: employee ? await publicEmployee(employee, stores).then((value) => value.avatarUrl) : "",
      commentCount: Math.max(Number(item.commentCount || 0), itemComments.length),
      comments: itemComments
    };
  }));
}

async function authUrlAction(payload) {
  if (!oaAppId) {
    const error = new Error("请先配置微信公众号 AppID");
    error.code = "WECHAT_OA_CONFIG_REQUIRED";
    throw error;
  }
  const redirectUri = configuredRedirect(payload.redirectUri);
  const state = await sessionSecretManager.signState(redirectUri);
  const url = new URL("https://open.weixin.qq.com/connect/oauth2/authorize");
  url.searchParams.set("appid", oaAppId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "snsapi_userinfo");
  url.searchParams.set("state", state);
  return ok({ authorizeUrl: `${url.toString()}#wechat_redirect`, redirectUri });
}

async function manualSessionAction() {
  if (employeeLoginMode !== MANUAL_REVIEW_MODE) {
    const error = new Error("当前环境未开放测试申请入口");
    error.code = "MANUAL_REVIEW_DISABLED";
    throw error;
  }
  const stores = await getStores();
  const session = await createSession(createManualIdentity());
  return ok({
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    bound: false,
    employee: null,
    stores,
    applicationStatus: "none",
    application: null,
    identityProvider: MANUAL_REVIEW_MODE,
    policy: policyMetadata()
  });
}

async function directLoginAction(payload) {
  if (!allowDirectLogin) {
    const error = new Error("当前环境未开放免授权登录");
    error.code = "DIRECT_LOGIN_DISABLED";
    throw error;
  }
  const stores = await getStores();
  const employees = await getCollection("employees");
  const { employee } = resolveDirectLoginEmployee({
    stores,
    employees,
    storeId: payload.storeId,
    employeeName: payload.employeeName
  });
  const employeeId = employee._id || employee.id;
  const syntheticOpenId = `direct:${employeeId}:${randomBytes(8).toString("hex")}`;
  const session = await createSession(syntheticOpenId, employeeId, {});
  const refreshedEmployee = await getFirst("employees", { _id: employeeId, status: "active" });
  return ok({
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    bound: true,
    employee: await publicEmployee(refreshedEmployee || employee, stores),
    stores
  });
}

async function oauthAction(payload) {
  const redirectUri = configuredRedirect(payload.redirectUri);
  if (!(await sessionSecretManager.verifyState(payload.state, redirectUri))) return fail("网页授权状态已过期，请重新进入", "WECHAT_OA_STATE_INVALID");
  const credentials = await exchangeOfficialCode(payload.code);
  const openId = credentials.openId;
  const wechatProfile = await fetchOfficialUserInfo(credentials.accessToken, openId);
  const user = await getFirst("users", { openId, status: "active" });
  const stores = await getStores();
  let employee = user?.employeeId ? await getFirst("employees", { _id: user.employeeId, status: "active" }) : null;
  if (employee && !isAllowlistedEmployee(employee)) employee = null;
  if (employee) {
    await db.collection("employees").doc(employee._id).update({
      ...(wechatProfile.avatarUrl ? { wechatAvatarUrl: wechatProfile.avatarUrl } : {}),
      ...(wechatProfile.nickname ? { wechatNickname: wechatProfile.nickname } : {}),
      updatedAt: now()
    });
    employee = await getFirst("employees", { _id: employee._id, status: "active" });
  }
  const session = await createSession(openId, employee?._id || "", wechatProfile);
  return ok({
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    bound: Boolean(employee),
    employee: employee ? await publicEmployee(employee, stores) : null,
    stores,
    applicationStatus: employee ? "approved" : "none",
    application: null,
    policy: policyMetadata()
  });
}

async function sessionAction(payload) {
  const session = await getSession(payload);
  const stores = await getStores();
  let employeeId = session.employeeId;
  if (!employeeId) {
    const user = await getFirst("users", { openId: session.openId, status: "active" });
    employeeId = user?.employeeId || "";
    if (employeeId) {
      await db.collection("webSessions").doc(session._id).update({ employeeId, updatedAt: now() });
    }
  }
  const employee = employeeId
    ? await getFirst("employees", { _id: employeeId, status: "active" })
    : null;
  const allowlistedEmployee = employee && isAllowlistedEmployee(employee) ? employee : null;
  return ok({
    bound: Boolean(allowlistedEmployee),
    employee: allowlistedEmployee ? await publicEmployee(allowlistedEmployee, stores) : null,
    stores,
    expiresAt: session.expiresAt,
    applicationStatus: allowlistedEmployee ? "approved" : "none",
    application: null,
    identityProvider: isManualIdentity(session.openId) ? MANUAL_REVIEW_MODE : "wechat-oauth",
    policy: policyMetadata()
  });
}

async function bindAction(payload) {
  const session = await getSession(payload);
  const existingUser = await getFirst("users", { openId: session.openId, status: "active" });
  if (existingUser?.employeeId) {
    const existingEmployee = await getFirst("employees", { _id: existingUser.employeeId, status: "active" });
    if (existingEmployee && isAllowlistedEmployee(existingEmployee)) {
      await db.collection("webSessions").doc(session._id).update({ employeeId: existingUser.employeeId, updatedAt: now() });
      await db.collection("employees").doc(existingUser.employeeId).update({
        ...(session.wechatAvatarUrl ? { wechatAvatarUrl: session.wechatAvatarUrl } : {}),
        ...(session.wechatNickname ? { wechatNickname: session.wechatNickname } : {}),
        updatedAt: now()
      });
      const stores = await getStores();
      const refreshedEmployee = await getFirst("employees", { _id: existingUser.employeeId, status: "active" });
      return ok({ bound: true, employee: await publicEmployee(refreshedEmployee || existingEmployee, stores), policy: policyMetadata() });
    }
  }

  const storeId = requireString(payload.storeId, "storeId");
  const employeeName = requireString(payload.employeeName, "employeeName");
  const stores = await getStores();
  resolveRegistrationStore(stores, storeId);
  assertEmployeeNotice(payload.noticeVersion);
  let employee;
  try {
    employee = resolveDirectLoginEmployee({
      stores,
      employees: await getCollection("employees"),
      storeId,
      employeeName
    }).employee;
  } catch (error) {
    return fail(error.message, error.code || "EMPLOYEE_NOT_FOUND");
  }
  return bindKnownEmployee({ session, employee, stores });
}

async function applicationStatusAction(payload) {
  const session = await getSession(payload);
  if (session.employeeId) {
    return ok({ bound: true, applicationStatus: "approved", application: null, identityProvider: isManualIdentity(session.openId) ? MANUAL_REVIEW_MODE : "wechat-oauth", policy: policyMetadata() });
  }
  return ok({
    bound: false,
    applicationStatus: "none",
    application: null,
    identityProvider: isManualIdentity(session.openId) ? MANUAL_REVIEW_MODE : "wechat-oauth",
    policy: policyMetadata()
  });
}

async function dataAction(payload) {
  const { session, employee } = await getBoundContext(payload);
  const supplier = isSupplier(employee);
  const supplierProducts = supplier ? allowedProductKeys(employee) : [];
  const [stores, regions, rawCourses, phrases, exams, questions, rewards, employees, cases, caseComments, loadedCaseAcknowledgements, phraseSubmissions, phrasePracticeAttempts, ledger, redemptions, progress, employeeProgress, attempts, employeeExamAttempts, employeeProductTasks, storeProductSales, storeTaskRewards] = await Promise.all([
    getCollection("stores"),
    getCollection("regions"),
    getCollection("courses"),
    getCollection("phrases"),
    getCollection("exams"),
    getCollection("questions"),
    getCollection("rewards"),
    getCollection("employees"),
    getCollection("cases"),
    getOptionalCollection("caseComments"),
    getOptionalCollection("caseAcknowledgements", 5000),
    getCollection("phraseSubmissions"),
    getOptionalCollection("phrasePracticeAttempts"),
    getOptionalCollection("goldenBeanLedger"),
    getOptionalCollection("redemptions"),
    getOptionalCollection("courseProgress"),
    getOptionalCollectionWhere("courseProgress", { employeeId: employee._id }),
    getOptionalCollection("examAttempts"),
    getOptionalCollectionWhere("examAttempts", { employeeId: employee._id }),
    getOptionalCollection("employeeProductTasks"),
    getOptionalCollection("storeProductSales"),
    getOptionalCollection("storeTaskRewards")
  ]);
  const acknowledgementCases = visibleCasePosts(cases).slice(0, 100);
  const caseAcknowledgements = await ensureCaseAcknowledgementRecords({
    cases: acknowledgementCases,
    employees,
    recipients: loadedCaseAcknowledgements
  });
  const filtered = filterSupplierData(employee, { courses: rawCourses, phrases, exams, cases, employees, stores });
  const visibleRawCourses = filtered.courses;
  const visiblePhrases = filtered.phrases;
  const visibleExams = filtered.exams;
  const productTaskStatuses = buildEmployeeProductStatuses({
    employeeId: employee._id,
    products: [...visibleRawCourses.filter((item) => (item.track || "product") === "product"), ...visiblePhrases, ...visibleExams],
    tasks: employeeProductTasks,
    periodKey: currentPeriodKey()
  });
  const productTaskByKey = new Map(productTaskStatuses.map((item) => [item.productKey, item]));
  const publishedCourses = await publicCourses(visibleRawCourses.filter((item) => item.status === "published"));
  // The global collection read is intentionally bounded for rankings, but a
  // current employee's progress must never depend on where their documents
  // happen to fall in that collection. Query the employee-scoped records
  // directly so the product cards agree with the course detail page.
  const courseProgress = employeeProgress;
  const progressByCourse = courseProgressByCourseId(courseProgress);
  const courseList = publishedCourses.map((item) => {
    const learningProgress = progressByCourse.get(String(item.id || ""));
    const taskStatusValue = productTaskByKey.get(productKey(item))?.status || "exam-required";
    return {
      ...item,
      progress: courseProgressPercent(item, learningProgress),
      // `completed` is reserved for a real learning record so the client can
      // still offer the course reward after a product task is auto-completed.
      completed: Boolean(learningProgress?.completed),
      learningCompleted: courseLearningCompleted(learningProgress),
      taskAutoCompleted: taskStatusValue === "completed",
      taskStatus: taskStatusValue
    };
  });
  const publishedExams = visibleExams.filter((item) => item.status === "published").map((exam) => {
    const examAttempts = employeeExamAttempts.filter((attempt) => attempt.examId === exam._id);
    const productCourses = publishedCourses.filter((course) => (course.track || "product") === "product" && productKey(course) === productKey(exam));
    const attemptCycle = resolveExamAttemptCycle({
      attempts: examAttempts,
      requiredCourseIds: productCourses.map((course) => course.id),
      courseProgress
    });
    return {
      ...normalizeId(exam),
      passScore: 90,
      maxAttempts: MAX_EXAM_ATTEMPTS,
      attemptCount: attemptCycle.attemptsUsed,
      attemptsRemaining: attemptCycle.attemptsRemaining,
      learningResetRequired: attemptCycle.relearningRequired,
      questions: questions.filter((question) => question.examId === exam._id).map((question) => {
        const { answerIndex, answerIndexes, explanation, ...publicQuestion } = normalizeId(question);
        return publicQuestion;
      }).sort(() => Math.random() - 0.5),
      completed: examAttempts.some((attempt) => attempt.passed !== false && Number(attempt.score || 0) >= 90),
      taskAutoCompleted: productTaskByKey.get(productKey(exam))?.status === "completed",
      taskStatus: productTaskByKey.get(productKey(exam))?.status || "exam-required"
    };
  });
  const activeEmployees = filtered.employees;
  const productGoldenBeansById = supplier ? productGoldenBeansByEmployee({
    employees: activeEmployees,
    ledger,
    productKeys: supplierProducts
  }) : {};
  const publicRanking = await Promise.all(activeEmployees.map(async (item) => {
    const metrics = learningMetricsForEmployee({
      employeeId: item._id || item.id,
      courses: visibleRawCourses,
      courseProgress: progress,
      phrases: visiblePhrases,
      phrasePracticeAttempts,
      goldenBeanLedger: ledger,
      exams: visibleExams,
      examAttempts: attempts,
      employeeProductTasks,
      productTaskPeriodKey: currentPeriodKey()
    });
    const productCompletionRates = {};
    if (supplier) {
      for (const product of supplierProducts) {
        const productCourses = visibleRawCourses.filter((entry) => productKey(entry) === product);
        const productPhrases = visiblePhrases.filter((entry) => productKey(entry) === product);
        const productExams = visibleExams.filter((entry) => productKey(entry) === product);
        productCompletionRates[product] = learningMetricsForEmployee({
          employeeId: item._id || item.id,
          courses: productCourses,
          courseProgress: progress,
          phrases: productPhrases,
          phrasePracticeAttempts,
          goldenBeanLedger: ledger,
          exams: productExams,
          examAttempts: attempts,
          employeeProductTasks,
          productTaskPeriodKey: currentPeriodKey()
        }).courseCompletionRate;
      }
    }
    const itemId = item._id || item.id;
    const notificationSummary = notificationSummaryForEmployee({
      employeeId: itemId,
      employeeRole: item.role,
      cases: filtered.cases,
      recipients: caseAcknowledgements
    });
    const publicItem = await publicEmployee(item, stores);
    return {
      ...publicItem,
      courseCompletionRate: metrics.courseCompletionRate,
      ...notificationSummary,
      ...(employee.role === "admin" ? {
        productLearningDetails: learningProductDetails({
          employeeId: itemId,
          courses: visibleRawCourses,
          courseProgress: progress,
          phrases: visiblePhrases,
          phrasePracticeAttempts,
          goldenBeanLedger: ledger,
          exams: visibleExams,
          examAttempts: attempts,
          employeeProductTasks,
          productTaskPeriodKey: currentPeriodKey()
        })
      } : { pendingNotifications: [] }),
      ...(supplier ? {
        goldenBeans: 0,
        productCompletionRates,
        productGoldenBeans: productGoldenBeansById[itemId] || {}
      } : {})
    };
  }));
  publicRanking.sort((a, b) => Number(b.goldenBeans || 0) - Number(a.goldenBeans || 0));
  const productTaskRankings = supplier
    ? supplierProductTaskRankings({
      employees: publicRanking,
      tasks: employeeProductTasks,
      periodKey: currentPeriodKey(),
      productKeys: supplierProducts
    })
    : buildProductTaskRankings({
      employees: publicRanking,
      tasks: employeeProductTasks,
      periodKey: currentPeriodKey()
    });
  const storeProductRankings = buildStoreProductRankings({
    stores,
    sales: storeProductSales,
    periodKey: currentPeriodKey(),
    ...(supplier ? { productKeys: supplierProducts } : {})
  });
  const visibleCaseRecords = visibleCasePosts(filtered.cases).slice(0, 100);
  const visibleCaseIds = new Set(visibleCaseRecords.map((item) => item._id || item.id));
  const visibleCases = await publicCases(
    visibleCaseRecords,
    caseComments.filter((item) => !item.deletedAt && visibleCaseIds.has(item.caseId)),
    employees,
    stores,
    caseAcknowledgements,
    { employeeId: employee._id, employeeRole: employee.role, isAdmin: employee.role === "admin" }
  );
  const employeePhraseAttempts = phrasePracticeAttempts.filter((item) => item.employeeId === employee._id);
  const phraseLedger = ledger.filter((item) => item.employeeId === employee._id && item.sourceType === "phrase" && Number(item.delta || 0) > 0);
  const phraseAudioUrls = await getTempFileURLs(visiblePhrases.map((item) => item.audioFileId || (isCloudFileId(item.audioUrl) ? item.audioUrl : "")));
  const publishedPhrases = visiblePhrases.filter((item) => item.status === "published").map((item) => {
    const phrase = normalizeId(item);
    const maxRewardedAttempts = phraseAttemptLimit(item);
    const taskAutoCompleted = productTaskByKey.get(productKey(phrase))?.status === "completed";
    const completedCount = phraseCompletionCount({ attempts: employeePhraseAttempts, ledger: phraseLedger, phraseId: phrase.id, maxRewardedAttempts });
    return {
      ...phrase,
      audioFileId: isCloudFileId(item.audioFileId || item.audioUrl) ? item.audioFileId || item.audioUrl : "",
      audioUrl: publicFileUrl(item.audioFileId || item.audioUrl, phraseAudioUrls),
      maxRewardedAttempts,
      completedCount,
      taskAutoCompleted,
      taskStatus: productTaskByKey.get(productKey(phrase))?.status || "exam-required"
    };
  });
  const phraseById = new Map(publishedPhrases.map((item) => [item.id, item]));
  const recognizedPhraseSubmissions = employeePhraseAttempts.filter((item) => item.passed !== false).map((item) => ({
    id: item._id || item.id,
    type: "phrase",
    title: item.title || `${phraseById.get(item.phraseId)?.title || "金句"}练习`,
    employeeId: employee._id,
    storeId: employee.storeId,
    createdAt: item.createdAt,
    status: "approved",
    goldenBeans: Number(item.goldenBeans || 0),
    phraseId: item.phraseId,
    recordingFileId: item.recordingDeletedAt ? "" : item.fileId
  }));
  const recordings = employeePhraseAttempts
    .filter((item) => item.fileId && !item.recordingDeletedAt)
    .map((item) => ({
      id: item._id || item.id,
      phraseId: item.phraseId,
      title: item.title || `${phraseById.get(item.phraseId)?.title || "金句"}练习`,
      createdAt: item.createdAt,
      fileId: item.fileId
    }))
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  const learningTodos = buildLearningTodos({
    employeeId: employee._id,
    courses: publishedCourses,
    courseProgress,
    phrases: publishedPhrases,
    phrasePracticeAttempts: employeePhraseAttempts,
    goldenBeanLedger: phraseLedger,
    exams: publishedExams,
    examAttempts: employeeExamAttempts,
    employeeProductTasks,
    productTaskPeriodKey: currentPeriodKey(),
    supplier
  });
  const notificationPreference = await getOptionalFirst("employeeNotificationPreferences", { employeeId: employee._id });
  const currentStore = stores.find((item) => item._id === employee.storeId || item.id === employee.storeId);
  const currentRegion = regions.find((item) => item._id === employee.regionId || item.id === employee.regionId);
  const currentSalesPeriod = currentPeriodKey();
  const storeTaskRewardOffers = buildStoreTaskRewardOffers({
    employee,
    store: currentStore || {},
    rewards: storeTaskRewards.map((item) => ({ ...normalizeId(item), threshold: 10 })),
    sales: storeProductSales,
    claims: redemptions,
    periodKey: currentSalesPeriod
  });
  const currentMetrics = learningMetricsForEmployee({
    employeeId: employee._id,
    courses: visibleRawCourses,
    courseProgress,
    phrases: visiblePhrases,
    phrasePracticeAttempts: employeePhraseAttempts,
    goldenBeanLedger: phraseLedger,
    exams: visibleExams,
    examAttempts: employeeExamAttempts,
    employeeProductTasks,
    productTaskPeriodKey: currentPeriodKey()
  });
  const currentNotificationSummary = notificationSummaryForEmployee({
    employeeId: employee._id,
      employeeRole: employee.role,
    cases: filtered.cases,
    recipients: caseAcknowledgements
  });
  return ok({
    bound: true,
    sessionExpiresAt: session.expiresAt,
    employee: {
      ...(await publicEmployee(employee, stores)),
      courseCompletionRate: currentMetrics.courseCompletionRate,
      examPassRate: currentMetrics.examPassRate,
      ...currentNotificationSummary,
      region: currentRegion?.name || ""
    },
    stores: stores.map(normalizeId),
    courses: courseList,
    phrases: publishedPhrases,
    exams: publishedExams,
    productTaskStatuses,
    productTaskRankings,
    storeProductRankings,
    storeTaskRewards: storeTaskRewardOffers,
    rewards: filterEligibleRewards(rewards).map(normalizeId),
    cases: visibleCases,
    submissions: [...cases, ...phraseSubmissions].filter((item) => item.employeeId === employee._id).map(normalizeId).concat(recognizedPhraseSubmissions),
    ranking: publicRanking,
    goldenBeanLedger: ledger.filter((item) => item.employeeId === employee._id).map(normalizeId),
    redemptions: redemptions.filter((item) => item.employeeId === employee._id).map(normalizeId),
    recordings,
    learningTodos: learningTodos.groups,
    learningTodoCount: learningTodos.count,
    learningTodoSummaryHash: learningTodos.summaryHash,
    notificationPreference: notificationPreference ? {
      enabled: notificationPreference.enabled === true,
      status: notificationPreference.status || (notificationPreference.enabled ? "enabled" : "not-enabled"),
      updatedAt: notificationPreference.updatedAt || ""
    } : { enabled: false, status: "not-enabled", updatedAt: "" },
    policy: policyMetadata(),
    currentStore: storeDisplayName(currentStore)
  });
}

async function notificationPreferenceAction(payload) {
  const { session, employee } = await getBoundContext(payload);
  const enabled = payload.enabled === true;
  await ensureCollectionExists("employeeNotificationPreferences");
  const current = await getOptionalFirst("employeeNotificationPreferences", { employeeId: employee._id });
  const record = {
    employeeId: employee._id,
    enabled,
    status: enabled ? "enabled" : "disabled",
    updatedAt: now(),
    ...(enabled ? { enabledAt: current?.enabledAt || now(), disabledAt: "" } : { disabledAt: now() })
  };
  if (current?._id) {
    await db.collection("employeeNotificationPreferences").doc(current._id).update(record);
  } else {
    await db.collection("employeeNotificationPreferences").add(record);
  }
  return ok({
    enabled,
    status: record.status,
    updatedAt: record.updatedAt,
    message: enabled ? "学习提醒已开启" : "学习提醒已关闭"
  });
}

async function courseDetailAction(payload) {
  const { employee } = await getBoundContext(payload);
  const courseId = requireString(payload.courseId, "courseId");
  const course = await getPublishedCourseById(courseId);
  if (!course) return fail("课程不存在或未发布", "COURSE_NOT_FOUND");
  if (!supplierCanViewProduct(employee, course)) return fail("当前供应商账号未授权查看该产品", "SUPPLIER_PRODUCT_FORBIDDEN");
  const fileId = optionalString(course.videoFileId) || (isCloudFileId(course.videoUrl) ? course.videoUrl : "");
  const slideImageFileIds = Array.isArray(course.slideImageFileIds) ? course.slideImageFileIds : [];
  const [videoUrl, coverImageUrl, slideImageTempUrls] = await Promise.all([
    resolveAsset(fileId || course.videoUrl),
    resolveAsset(course.coverImage || course.coverImageUrl),
    getTempFileURLs(slideImageFileIds)
  ]);
  const [progress, employeeProductTasks] = await Promise.all([
    getOptionalFirst("courseProgress", { employeeId: employee._id, courseId }),
    getOptionalCollection("employeeProductTasks")
  ]);
  const productTask = taskForProduct(employeeProductTasks, employee._id, productKey(course), currentPeriodKey());
  const pptProgress = course.resourceType === "ppt" && Number(course.slideCount || 0) > 0
    ? normalizePptProgress(progress, Number(course.slideCount))
    : null;
  const videoProgress = !pptProgress ? normalizeVideoProgress(progress) : null;
  const currentTaskStatus = taskStatus(productTask);
  return ok({ course: {
    ...normalizeId(course),
    videoUrl,
    hasVideo: Boolean(videoUrl),
    progress: courseProgressPercent(course, progress),
    completed: Boolean(progress?.completed),
    learningCompleted: courseLearningCompleted(progress),
    taskAutoCompleted: currentTaskStatus === "completed",
    taskStatus: currentTaskStatus,
    coverImageUrl,
    slideImageUrls: slideImageFileIds.map((slideFileId) => publicFileUrl(slideFileId, slideImageTempUrls)).filter(Boolean),
    ...(pptProgress ? { pptProgress } : {}),
    ...(videoProgress ? { videoProgress } : {})
  } });
}

async function syncVideoProgressAction(payload) {
  const { employee } = await getBoundContext(payload);
  const readOnlyError = assertSupplierReadOnly(employee);
  if (readOnlyError) return readOnlyError;
  const courseId = requireString(payload.courseId, "courseId");
  const course = await getPublishedCourseById(courseId);
  if (!course) return fail("课程不存在或未发布", "COURSE_NOT_FOUND");
  if (!supplierCanViewProduct(employee, course)) return fail("当前供应商账号未授权查看该产品", "SUPPLIER_PRODUCT_FORBIDDEN");
  if (course.resourceType === "ppt" && Number(course.slideCount || 0) > 0) {
    return fail("PPT 课程不使用视频进度", "VIDEO_COURSE_REQUIRED");
  }
  if (!optionalString(course.videoUrl || course.videoFileId)) {
    return fail("该课程暂未上传视频", "COURSE_VIDEO_REQUIRED");
  }

  const existing = await getOptionalFirst("courseProgress", { employeeId: employee._id, courseId });
  const updatedAt = now();
  const progress = updateVideoProgress(existing, payload, updatedAt, Number(course.videoDurationSeconds || 0));
  const record = {
    employeeId: employee._id,
    courseId,
    maxWatchedSeconds: progress.maxWatchedSeconds,
    videoDurationSeconds: progress.videoDurationSeconds,
    videoWatchCompleted: progress.videoWatchCompleted,
    videoLastSyncedAt: progress.videoLastSyncedAt,
    progress: progress.videoDurationSeconds > 0
      ? Math.min(100, Math.round(progress.maxWatchedSeconds / progress.videoDurationSeconds * 100))
      : 0,
    updatedAt,
    clientContext: requestClientContext(payload)
  };
  if (existing) await db.collection("courseProgress").doc(existing._id).update(record);
  else await addDocument("courseProgress", { ...record, completed: false, createdAt: updatedAt });
  return ok({ progress: normalizeVideoProgress({ ...existing, ...record }) });
}

function pptCourse(course) {
  if (course?.resourceType !== "ppt" || Number(course.slideCount || 0) <= 0) {
    const error = new Error("该课程不是可逐页学习的 PPT 资料");
    error.code = "PPT_COURSE_REQUIRED";
    throw error;
  }
  return {
    slideCount: Math.max(1, Number(course.slideCount)),
    minSeconds: Math.max(1, Number(course.slideMinSeconds || 3))
  };
}

function pptProgressRecord(employeeId, courseId, progress, updatedAt) {
  return {
    employeeId,
    courseId,
    currentSlide: Number(progress.currentSlide || 0),
    unlockedSlides: Number(progress.unlockedSlides || 0),
    activeSlide: Number.isInteger(progress.activeSlide) ? progress.activeSlide : null,
    slideStartedAt: optionalString(progress.slideStartedAt),
    readingCompleted: Boolean(progress.readingCompleted),
    progress: Number(progress.progress || 0),
    updatedAt
  };
}

async function savePptProgress(employeeId, courseId, existing, progress, updatedAt) {
  const record = pptProgressRecord(employeeId, courseId, progress, updatedAt);
  if (existing) await db.collection("courseProgress").doc(existing._id).update(record);
  else await addDocument("courseProgress", { ...record, completed: false, createdAt: updatedAt });
  return record;
}

async function pptProgressAction(payload) {
  const { employee } = await getBoundContext(payload);
  const courseId = requireString(payload.courseId, "courseId");
  const course = await getPublishedCourseById(courseId);
  if (!course) return fail("课程不存在或未发布", "COURSE_NOT_FOUND");
  if (!supplierCanViewProduct(employee, course)) return fail("当前供应商账号未授权查看该产品", "SUPPLIER_PRODUCT_FORBIDDEN");
  const metadata = pptCourse(course);
  const progress = await getOptionalFirst("courseProgress", { employeeId: employee._id, courseId });
  return ok({ progress: normalizePptProgress(progress, metadata.slideCount) });
}

async function startPptSlideAction(payload) {
  const { employee } = await getBoundContext(payload);
  const readOnlyError = assertSupplierReadOnly(employee);
  if (readOnlyError) return readOnlyError;
  const courseId = requireString(payload.courseId, "courseId");
  const course = await getPublishedCourseById(courseId);
  if (!course) return fail("课程不存在或未发布", "COURSE_NOT_FOUND");
  if (!supplierCanViewProduct(employee, course)) return fail("当前供应商账号未授权查看该产品", "SUPPLIER_PRODUCT_FORBIDDEN");
  const metadata = pptCourse(course);
  const existing = await getOptionalFirst("courseProgress", { employeeId: employee._id, courseId });
  const updatedAt = now();
  const progress = startPptSlide(existing, Number(payload.slideIndex), metadata.slideCount, updatedAt);
  const saved = await savePptProgress(employee._id, courseId, existing, progress, updatedAt);
  return ok({ progress: normalizePptProgress(saved, metadata.slideCount) });
}

async function completePptSlideAction(payload) {
  const { employee } = await getBoundContext(payload);
  const readOnlyError = assertSupplierReadOnly(employee);
  if (readOnlyError) return readOnlyError;
  const courseId = requireString(payload.courseId, "courseId");
  const course = await getPublishedCourseById(courseId);
  if (!course) return fail("课程不存在或未发布", "COURSE_NOT_FOUND");
  if (!supplierCanViewProduct(employee, course)) return fail("当前供应商账号未授权查看该产品", "SUPPLIER_PRODUCT_FORBIDDEN");
  const metadata = pptCourse(course);
  const existing = await getOptionalFirst("courseProgress", { employeeId: employee._id, courseId });
  const updatedAt = now();
  const progress = completePptSlide(existing, Number(payload.slideIndex), metadata.slideCount, metadata.minSeconds, updatedAt);
  const saved = await savePptProgress(employee._id, courseId, existing, progress, updatedAt);
  return ok({ progress: normalizePptProgress(saved, metadata.slideCount) });
}

async function completeCourseAction(payload) {
  const { employee } = await getBoundContext(payload);
  const readOnlyError = assertSupplierReadOnly(employee);
  if (readOnlyError) return readOnlyError;
  const courseId = requireString(payload.courseId, "courseId");
  const course = await getPublishedCourseById(courseId);
  if (!course) return fail("课程不存在或未发布", "COURSE_NOT_FOUND");
  if (!supplierCanViewProduct(employee, course)) return fail("当前供应商账号未授权查看该产品", "SUPPLIER_PRODUCT_FORBIDDEN");
  const progress = await getOptionalFirst("courseProgress", { employeeId: employee._id, courseId });
  const isPptCourse = course.resourceType === "ppt" && Number(course.slideCount || 0) > 0;
  if (isPptCourse) {
    const pptProgress = normalizePptProgress(progress, Number(course.slideCount));
    if (payload.pptCompleted !== true || !pptProgress.readingCompleted) {
      return fail("请按顺序完成全部 PPT 页面", "PPT_READING_NOT_FINISHED");
    }
  } else {
    if (!optionalString(course.videoUrl || course.videoFileId)) return fail("该课程暂未上传视频，不能获得金豆", "COURSE_VIDEO_REQUIRED");
    if (!canCompleteVideo(progress)) return fail("请先完整播放视频再领取金豆", "COURSE_VIDEO_NOT_FINISHED");
  }
  const progressRecord = { employeeId: employee._id, courseId, progress: 100, completed: true, updatedAt: now() };
  if (progress) await db.collection("courseProgress").doc(progress._id).update(progressRecord);
  else await addDocument("courseProgress", { ...progressRecord, createdAt: now() });
  const key = productKey(course);
  const rewardDelta = isPptCourse ? 0 : Number(course.goldenBeans || 0);
  const award = rewardDelta > 0
    ? await addCappedGoldenBeans({ employeeId: employee._id, sourceType: "course", sourceId: courseId, productKey: key, delta: rewardDelta, reason: `完成课程：${course.title}`, createdBy: "employee-web", productCap: await productRewardCap(key) })
    : { delta: 0 };
  const latest = await getFirst("employees", { _id: employee._id });
  return ok({ courseId, award, goldenBeans: Number(latest?.goldenBeans || 0) });
}

async function resetProductCourseProgress(employeeId, productKeyValue) {
  const [courses, progress] = await Promise.all([
    getCollection("courses"),
    getOptionalCollectionWhere("courseProgress", { employeeId })
  ]);
  const courseIds = new Set(courses
    .filter((course) => (course.track || "product") === "product" && productKey(course) === productKeyValue)
    .map((course) => String(course._id || course.id)));
  const matchingProgress = progress.filter((item) => item.employeeId === employeeId && courseIds.has(String(item.courseId)));
  const updatedAt = now();
  await Promise.all(matchingProgress.map((item) => db.collection("courseProgress").doc(item._id).update({
    progress: 0,
    completed: false,
    maxWatchedSeconds: 0,
    videoWatchCompleted: false,
    videoLastSyncedAt: "",
    currentSlide: 0,
    unlockedSlides: 0,
    activeSlide: null,
    slideStartedAt: "",
    readingCompleted: false,
    updatedAt
  })));
  return matchingProgress.length;
}

function answerMatches(question, answer) {
  if (question.type === "multiple") {
    const expected = (question.answerIndexes || []).map(Number).sort().join(",");
    const actual = (Array.isArray(answer) ? answer : [answer]).map(Number).sort().join(",");
    return expected && expected === actual;
  }
  return Number(answer) === Number(question.answerIndex);
}

async function productLearningPrerequisite(employeeId, exam, forceCourseLearning = false, requireAllLearning = false) {
  const key = productKey(exam);
  const [tasks, courses, phrases, progress, phraseAttempts] = await Promise.all([
    getOptionalCollectionWhere("employeeProductTasks", { employeeId }),
    getCollection("courses"),
    getCollection("phrases"),
    getOptionalCollectionWhere("courseProgress", { employeeId }),
    getOptionalCollectionWhere("phrasePracticeAttempts", { employeeId })
  ]);
  const status = taskStatus(taskForProduct(tasks, employeeId, key, currentPeriodKey()));
  if (status !== "learning-required" && !forceCourseLearning) return null;
  const learning = evaluateProductLearningPrerequisite({
    employeeId,
    productKey: key,
    courses,
    phrases,
    progress,
    phraseAttempts,
    forceCourseLearning,
    requireAllLearning
  });
  if (!learning.configured) {
    return fail("该产品尚未配置必修视频或 PPT，请联系总部管理员", "PRODUCT_LEARNING_NOT_CONFIGURED");
  }
  if (learning.missingCourseCount || learning.missingPhraseCount) {
    const pending = [
      learning.missingCourseCount ? `产品资料 ${learning.missingCourseCount} 项` : "",
      learning.missingPhraseCount ? `开口说 ${learning.missingPhraseCount} 项` : ""
    ].filter(Boolean).join("、");
    return fail(`请先完成${pending}，再参加考试`, "PRODUCT_LEARNING_PREREQUISITES_NOT_MET", {
      pendingCourseCount: learning.missingCourseCount,
      pendingPhraseCount: learning.missingPhraseCount
    });
  }
  return null;
}

async function submitExamAction(payload) {
  const { employee } = await getBoundContext(payload);
  const readOnlyError = assertSupplierReadOnly(employee);
  if (readOnlyError) return readOnlyError;
  const examId = requireString(payload.examId, "examId");
  const exam = await getFirst("exams", { _id: examId, status: "published" });
  if (!exam) return fail("考试不存在或未发布", "EXAM_NOT_FOUND");
  if (!supplierCanViewProduct(employee, exam)) return fail("当前供应商账号未授权查看该产品", "SUPPLIER_PRODUCT_FORBIDDEN");
  const key = productKey(exam);
  const [previousAttempts, allCourses, employeeProgress, productTasks] = await Promise.all([
    getOptionalCollectionWhere("examAttempts", { employeeId: employee._id }),
    getCollection("courses"),
    getOptionalCollectionWhere("courseProgress", { employeeId: employee._id }),
    getOptionalCollectionWhere("employeeProductTasks", { employeeId: employee._id })
  ]);
  const employeeAttempts = previousAttempts.filter((attempt) => attempt.employeeId === employee._id && attempt.examId === examId);
  const requiredCourses = allCourses.filter((course) => (
    course.status === "published" && (course.track || "product") === "product" && productKey(course) === key
  ));
  const attemptCycle = resolveExamAttemptCycle({
    attempts: employeeAttempts,
    requiredCourseIds: requiredCourses.map((course) => String(course._id || course.id)),
    courseProgress: employeeProgress
  });
  if (attemptCycle.relearningRequired) {
    if (!requiredCourses.length) return fail("该产品尚未配置必修视频或 PPT，请联系总部管理员", "PRODUCT_LEARNING_NOT_CONFIGURED");
    return fail("请重新阅读资料、看完该产品视频，并逐项点击完成后恢复两次考试机会", "EXAM_RELEARNING_REQUIRED");
  }
  if (attemptCycle.attemptsUsed >= MAX_EXAM_ATTEMPTS) {
    return fail("本学习周期的两次考试机会已用完，请重新完成该产品资料", "EXAM_ATTEMPTS_EXHAUSTED");
  }
  const taskAlreadyCompleted = taskStatus(taskForProduct(productTasks, employee._id, key, currentPeriodKey())) === "completed";
  const hasFailedAttempt = employeeAttempts.some((attempt) => attempt.passed === false);
  const prerequisiteError = await productLearningPrerequisite(
    employee._id,
    exam,
    hasFailedAttempt || taskAlreadyCompleted,
    taskAlreadyCompleted && !hasFailedAttempt
  );
  if (prerequisiteError) return prerequisiteError;
  const questionResult = await db.collection("questions").where({ examId }).get();
  const questions = questionResult.data || [];
  const answers = Array.isArray(payload.answers) ? payload.answers : [];
  const answerMap = Object.fromEntries(answers.map((answer) => [answer.questionId, answer.value ?? answer.answerIndex]));
  const correctCount = questions.reduce((count, question) => count + (answerMatches(question, answerMap[question._id]) ? 1 : 0), 0);
  const score = questions.length ? Math.round(correctCount / questions.length * 100) : 0;
  const passed = score >= 90;
  const attemptResult = await addDocument("examAttempts", { employeeId: employee._id, examId, attemptCycle: attemptCycle.cycle, answers, score, passed, correctCount, questionCount: questions.length, clientContext: requestClientContext(payload), createdAt: now() });
  const attemptsUsed = attemptCycle.attemptsUsed + 1;
  const relearningRequired = !passed && attemptsUsed >= MAX_EXAM_ATTEMPTS;
  const resetCourseCount = relearningRequired ? await resetProductCourseProgress(employee._id, key) : 0;
  const award = passed ? await addCappedGoldenBeans({ employeeId: employee._id, sourceType: "exam", sourceId: examId, productKey: key, delta: Number(exam.goldenBeans || 0), reason: `通过考试：${exam.title}`, createdBy: "employee-web", productCap: await productRewardCap(key) }) : null;
  const latest = await getFirst("employees", { _id: employee._id });
  return ok({ attemptId: attemptResult.id, score, passed, award, goldenBeans: Number(latest?.goldenBeans || 0), attemptsUsed, attemptsRemaining: examAttemptsRemaining(attemptsUsed), relearningRequired, resetCourseCount });
}

async function submitContentAction(payload) {
  const { session, employee } = await getBoundContext(payload);
  const readOnlyError = assertSupplierReadOnly(employee);
  if (readOnlyError) return readOnlyError;
  const type = requireString(payload.type, "type");
  const collectionName = collectionByType[type];
  if (!collectionName) return fail("不支持的提交类型", "INVALID_CONTENT_TYPE");
  const title = requireString(payload.title, "title");
  if (title.length > 80) return fail("标题不能超过 80 个字", "TITLE_TOO_LONG");
  const content = optionalString(payload.content);
  if (content.length > 5000) return fail("正文不能超过 5000 个字", "CONTENT_TOO_LONG");
  const caseMedia = type === "case" ? normalizeCaseMedia(payload) : { images: [], videoFileId: "" };
  if (type === "case") {
    assertCasePrivacyConfirmation({
      confirmed: payload.casePrivacyConfirmed,
      version: payload.casePrivacyVersion
    });
  }
  const taskRewards = await getTaskRewards();
  const record = {
    type, title, employeeId: employee._id, storeId: employee.storeId, regionId: employee.regionId,
    publisherName: employee.name, publisherRole: "employee",
    status: "pending", goldenBeans: configuredSubmissionReward(taskRewards, type, defaultSubmissionRewards),
    content, phraseId: optionalString(payload.phraseId),
    recordingFileId: optionalString(payload.recordingFileId),
    images: caseMedia.images,
    videoFileId: caseMedia.videoFileId,
    ...(type === "case" ? {
      casePrivacyConfirmed: true,
      casePrivacyVersion: CASE_PRIVACY_VERSION,
      casePrivacyConfirmedAt: now()
    } : {}),
    createdAt: now()
  };
  if (type === "phrase" && !record.phraseId) return fail("缺少开口说任务", "PHRASE_ID_REQUIRED");
  if (type === "phrase" && !isCloudFileId(record.recordingFileId)) return fail("缺少有效录音文件", "RECORDING_FILE_REQUIRED");
  if (type === "case" && !record.content && record.images.length === 0 && !record.videoFileId) return fail("请填写文字或上传媒体", "CONTENT_REQUIRED");
  if (type === "phrase") await requireOwnedMedia(employee._id, [record.recordingFileId], "audio/");
  if (record.images.length) await requireOwnedMedia(employee._id, record.images.map((image) => image.fileId), "image/");
  if (record.videoFileId) await requireOwnedMedia(employee._id, [record.videoFileId], "video/");
  if (shouldRunWechatContentSecurity({ openId: session.openId, appId: oaAppId, appSecret: oaAppSecret })) {
    await assertTextSafe({
      content: [record.title, record.content].filter(Boolean).join("\n"),
      openId: session.openId,
      scene: type === "case" ? 4 : 1,
      appId: oaAppId,
      appSecret: oaAppSecret
    });
  }
  const result = await addDocument(collectionName, record);
  return ok({ submissionId: result.id, submission: { id: result.id, ...record }, message: type === "case" ? "案例已提交管理员审核，通过后会展示在案例广场" : "内容已提交" });
}

async function uploadMediaAction(payload) {
  const { session, employee } = await getBoundContext(payload);
  const readOnlyError = assertSupplierReadOnly(employee);
  if (readOnlyError) return readOnlyError;
  const { contentType, content: fileContent, extension, folder } = parseMediaDataUrl(payload.dataUrl);
  const isReceiptUpload = isPrivateReceiptUploadFolder(payload.folder);
  if (fileContent.length === 0 || fileContent.length > maxUploadBytes) return fail("文件大小超过限制", "FILE_TOO_LARGE");
  if (contentType.startsWith("image/") && !isReceiptUpload && shouldRunWechatContentSecurity({ openId: session.openId, appId: oaAppId, appSecret: oaAppSecret })) {
    await assertImageSafe({
      file: { filename: `upload.${extension}`, contentType, content: fileContent },
      appId: oaAppId,
      appSecret: oaAppSecret
    });
  }
  const uploadResult = await app.uploadFile({ cloudPath: `${folder}/${employee._id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`, fileContent });
  await addDocument("webMediaUploads", {
    employeeId: employee._id,
    fileId: uploadResult.fileID,
    contentType,
    size: fileContent.length,
    folder,
    createdAt: now()
  });
  return ok({ fileID: uploadResult.fileID, size: fileContent.length, contentType, url: await resolveAsset(uploadResult.fileID) });
}

async function submitStoreReceiptAction(payload) {
  const { employee } = await getBoundContext(payload);
  const readOnlyError = assertSupplierReadOnly(employee);
  if (readOnlyError) return readOnlyError;
  const fileId = requireString(payload.fileId || payload.fileID, "fileId");
  const media = await getOptionalFirst("webMediaUploads", { employeeId: employee._id, fileId });
  if (!media || !String(media.contentType || "").startsWith("image/")) return fail("请先上传有效的小票图片", "RECEIPT_IMAGE_INVALID");
  if (Number(media.size || 0) > maxReceiptBytes) return fail("小票图片不能超过 8MB", "RECEIPT_FILE_TOO_LARGE");
  const imageUrl = await resolveAsset(fileId);
  if (!imageUrl) return fail("小票图片暂时无法读取，请重新上传", "RECEIPT_IMAGE_UNAVAILABLE");
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) return fail("小票图片暂时无法读取，请重新上传", "RECEIPT_IMAGE_UNAVAILABLE");
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  let ocr;
  try {
    ocr = await recognizeReceipt(imageBuffer);
  } catch (error) {
    const code = error?.code === "RECEIPT_OCR_NOT_CONFIGURED"
      ? "RECEIPT_OCR_NOT_CONFIGURED"
      : "RECEIPT_OCR_UNAVAILABLE";
    console.error("[employeeWeb-receipt-ocr]", { code, upstreamCode: error?.code || "RECEIPT_OCR_FAILED" });
    const upstreamCode = String(error?.code || "");
    const permissionFailure = /AuthFailure|UnauthorizedOperation|Forbidden|LimitExceeded/i.test(upstreamCode);
    return fail(
      code === "RECEIPT_OCR_NOT_CONFIGURED"
        ? "小票识别服务尚未配置，请联系管理员"
        : permissionFailure
          ? "小票识别服务权限或套餐未开通，请联系管理员"
          : "小票识别服务暂时不可用，请稍后重试",
      code
    );
  }
  const lines = ocr.textDetections.map((item) => item.DetectedText || "");
  const periodKey = currentPeriodKey();
  const { data: sales = [] } = await db.collection("storeProductSales")
    .where({ storeId: employee.storeId, periodKey }).limit(100).get()
    .catch(() => ({ data: [] }));
  const aliases = Object.fromEntries(sales
    .filter((sale) => sale.productKey)
    .map((sale) => [sale.productKey, [sale.productName].filter(Boolean)]));
  const parsed = require("./_shared/storeReceiptCore").parseReceiptFields(lines, aliases);
  const ocrConfidence = ocr.textDetections.length ? ocr.textDetections.reduce((sum, item) => sum + Number(item.Confidence || 0), 0) / ocr.textDetections.length / 100 : 0;
  const imageSha256 = createHash("sha256").update(imageBuffer).digest("hex");
  const raw = normalizeReceiptResult({
    employeeId: employee._id,
    storeId: employee.storeId,
    storeName: parsed.storeName,
    productKey: parsed.productKey,
    receiptNo: parsed.receiptNo,
    saleDate: parsed.saleDate,
    quantity: parsed.quantity,
    confidence: ocrConfidence,
    imageFileId: fileId,
    imageSha256,
    source: "tencent-ocr"
  });
  if (raw.quantity <= 0 || !raw.productKey) return fail("小票暂未识别出任务商品或有效数量，请等待后台复核", "RECEIPT_REVIEW_REQUIRED", { receipt: { ...raw, status: "review" } });
  const store = (await getStores()).find((item) => item.id === employee.storeId);
  const storeText = normalizeReceiptText(parsed.storeName);
  const expectedStoreText = normalizeReceiptText(store?.name || "");
  const storeMatches = Boolean(storeText && expectedStoreText && (storeText.includes(expectedStoreText) || expectedStoreText.includes(storeText)));
  const canCount = canCountStoreReceipt({ employee, store });
  const status = raw.status === "approved" && canCount && raw.storeId && store && raw.storeId === employee.storeId && storeMatches && raw.receiptNo && raw.saleDate
    ? "approved"
    : raw.status === "approved" && !canCount
      ? "recognized"
      : "review";
  const receipt = { ...raw, fingerprint: raw.fingerprint || receiptFingerprint(raw), storeName: store?.name || raw.storeName, status, reviewReason: status === "review" ? "门店、单号、日期或识别置信度需要复核" : "", updatedAt: now() };
  await ensureCollectionExists("storeReceipts");
  const result = await db.runTransaction(async (transaction) => {
    const existingResult = await transaction.collection("storeReceipts").where({ fingerprint: receipt.fingerprint }).limit(1).get().catch(() => ({ data: [] }));
    const duplicate = existingResult.data?.find((item) => item.status !== "rejected");
    if (duplicate) return { duplicate: true, receipt: normalizeId(duplicate) };
    const added = await addDocument("storeReceipts", receipt, transaction);
    if (status === "approved") {
      const saleResult = await transaction.collection("storeProductSales").where({ storeId: employee.storeId, productKey: receipt.productKey, periodKey }).limit(1).get().catch(() => ({ data: [] }));
      const sale = saleResult.data?.[0];
      if (sale) await transaction.collection("storeProductSales").doc(sale._id).update({ completedQuantity: command.inc(receipt.quantity), updatedAt: now() });
      return { receipt: { ...receipt, id: added.id }, addedQuantity: sale ? receipt.quantity : 0, taskMissing: !sale };
    }
    return { receipt: { ...receipt, id: added.id } };
  });
  if (result.duplicate) return ok({ receipt: result.receipt, duplicate: true, message: "这张小票已经提交过，未重复累计" });
  if (status === "recognized") return ok({ receipt: result.receipt, message: "小票识别成功，总部账号不计入门店任务" });
  if (status !== "approved") return ok({ receipt: result.receipt, message: "小票识别不通过，请重新上传清晰图片或等待后台复核" });
  if (!result.addedQuantity) return ok({ receipt: result.receipt, message: "小票已识别，等待总部设置该产品门店任务后计入" });
  return ok({ receipt: result.receipt, addedQuantity: result.addedQuantity, message: `已计入门店任务：${result.addedQuantity} 盒` });
}

async function acceptRecordingNoticeAction(payload) {
  const { employee } = await getBoundContext(payload);
  const readOnlyError = assertSupplierReadOnly(employee);
  if (readOnlyError) return readOnlyError;
  assertRecordingNotice(payload.noticeVersion);
  const acceptedAt = now();
  await db.collection("employees").doc(employee._id).update({
    recordingNoticeVersion: RECORDING_NOTICE_VERSION,
    recordingNoticeAcceptedAt: acceptedAt,
    updatedAt: acceptedAt
  });
  return ok({ noticeVersion: RECORDING_NOTICE_VERSION, acceptedAt });
}

async function deleteRecordingAction(payload) {
  const { employee } = await getBoundContext(payload);
  const readOnlyError = assertSupplierReadOnly(employee);
  if (readOnlyError) return readOnlyError;
  const fileId = requireString(payload.fileId, "fileId");
  const media = await getOptionalFirst("webMediaUploads", { employeeId: employee._id, fileId });
  if (!media || !String(media.contentType || "").startsWith("audio/")) {
    return fail("录音不存在或不属于当前员工", "RECORDING_NOT_FOUND");
  }
  if (media.deletedAt) return ok({ fileId, deleted: true, duplicate: true });
  const requestedAt = now();
  await db.collection("webMediaUploads").doc(media._id).update({ deleteStatus: "processing", deleteRequestedAt: requestedAt, updatedAt: requestedAt });
  try {
    await app.deleteFile({ fileList: [fileId] });
  } catch (error) {
    await db.collection("webMediaUploads").doc(media._id).update({
      deleteStatus: "retry",
      deleteError: String(error?.message || "文件删除失败").slice(0, 300),
      updatedAt: now()
    });
    throw Object.assign(new Error("录音删除暂未完成，请稍后重试"), { code: "RECORDING_DELETE_RETRY" });
  }
  const attemptResult = await db.collection("phrasePracticeAttempts").where({ employeeId: employee._id, fileId }).limit(100).get().catch((error) => (
    isMissingCollectionError(error) ? ({ data: [] }) : Promise.reject(error)
  ));
  const deletedAt = now();
  await Promise.all((attemptResult.data || []).map((attempt) => db.collection("phrasePracticeAttempts").doc(attempt._id).update({
    recordingDeletedAt: deletedAt,
    recordingDeleteReason: "employee_request",
    updatedAt: deletedAt
  })));
  await db.collection("webMediaUploads").doc(media._id).update({
    deleteStatus: "deleted",
    deletedAt,
    deletedBy: employee._id,
    updatedAt: deletedAt
  });
  return ok({ fileId, deleted: true, duplicate: false });
}

async function recognizePhraseAction(payload) {
  const { employee } = await getBoundContext(payload);
  const readOnlyError = assertSupplierReadOnly(employee);
  if (readOnlyError) return readOnlyError;
  assertRecordingNotice(employee.recordingNoticeVersion);
  const phraseId = requireString(payload.phraseId, "phraseId");
  const fileId = requireString(payload.fileId, "fileId");
  if (!isCloudFileId(fileId)) return fail("录音文件无效，请重新录音", "PHRASE_AUDIO_NOT_FOUND");
  const phrase = await getFirst("phrases", { _id: phraseId, status: "published" });
  if (!phrase) return fail("话术不存在或未发布", "PHRASE_NOT_FOUND");
  if (!supplierCanViewProduct(employee, phrase)) return fail("当前供应商账号未授权查看该产品", "SUPPLIER_PRODUCT_FORBIDDEN");
  const [media] = await requireOwnedMedia(employee._id, [fileId], "audio/");
  if (media.contentType !== "audio/wav") return fail("当前录音格式暂不支持，请重新录音", "PHRASE_AUDIO_FORMAT_UNSUPPORTED");
  const voiceFormat = voiceFormatForContentType(media.contentType);
  const phraseProductKey = productKey(phrase);
  const maxRewardedAttempts = phraseAttemptLimit(phrase);
  const [practiceResult, completionLedger] = await Promise.all([
    db.collection("phrasePracticeAttempts").where({ employeeId: employee._id, phraseId }).limit(100).get().catch((error) => (isMissingCollectionError(error) ? ({ data: [] }) : Promise.reject(error))),
    db.collection("goldenBeanLedger").where({ employeeId: employee._id, sourceType: "phrase" }).limit(1000).get().catch((error) => (isMissingCollectionError(error) ? ({ data: [] }) : Promise.reject(error)))
  ]);
  const attempts = practiceResult.data || [];
  const completedCount = phraseCompletionCount({ attempts, ledger: completionLedger.data || [], phraseId, maxRewardedAttempts });
  const existingAttempt = attempts.find((attempt) => attempt.fileId === fileId);
  if (existingAttempt) {
    const latest = await getFirst("employees", { _id: employee._id });
    return ok({
      passed: existingAttempt.passed !== false,
      text: existingAttempt.recognizedText || "",
      score: Number(existingAttempt.score || 0),
      completedCount,
      maxRewardedAttempts,
      award: { awarded: false, delta: 0, duplicate: true },
      goldenBeans: Number(latest?.goldenBeans || 0)
    });
  }

  const tempUrl = await resolveAsset(fileId);
  if (!tempUrl) return fail("录音文件暂时无法读取，请重新录音", "PHRASE_AUDIO_NOT_FOUND");
  const audioResponse = await fetch(tempUrl);
  if (!audioResponse.ok) return fail("录音文件下载失败，请重新录音", "PHRASE_AUDIO_DOWNLOAD_FAILED");
  const audio = Buffer.from(await audioResponse.arrayBuffer());
  if (audio.length === 0) return fail("录音为空，请重新录音", "PHRASE_AUDIO_EMPTY");
  if (audio.length > maxSpeechBytes) return fail("录音文件过大，请缩短后重试", "PHRASE_AUDIO_TOO_LARGE");
  const duration = wavDurationSeconds(audio);
  if (duration < 2) return fail("录音至少需要 2 秒，请重新录音", "PHRASE_AUDIO_TOO_SHORT");
  if (duration > 60) return fail("录音不能超过 60 秒，请缩短后重试", "PHRASE_AUDIO_TOO_LONG");

  let recognition;
  try {
    recognition = await recognizeAudio({ audio, voiceFormat });
  } catch (error) {
    if (error.code === "SPEECH_NOT_CONFIGURED") throw error;
    console.error("[employeeWeb-speech-error]", { phraseId, code: error.code || "SPEECH_FAILED", message: error.message });
    throw Object.assign(new Error("语音识别失败，请重新录音"), { code: "SPEECH_RECOGNITION_FAILED" });
  }
  const comparison = compareSpeechText(phrase.script, recognition.text);
  console.log("[employeeWeb-speech-recognition]", {
    phraseId,
    productKey: phraseProductKey,
    requestId: recognition.requestId,
    recognizedLength: recognition.text.length,
    expectedLength: phrase.script.length,
    score: comparison.score,
    matched: comparison.matched
  });
  const attemptRecord = {
    employeeId: employee._id,
    phraseId,
    productKey: phraseProductKey,
    fileId,
    title: `${phrase.title}练习`,
    passed: comparison.matched,
    score: comparison.score,
    recognizedText: recognition.text,
    counted: false,
    goldenBeans: 0,
    clientContext: requestClientContext(payload),
    createdAt: now()
  };
  if (!comparison.matched) {
    await addDocument("phrasePracticeAttempts", attemptRecord);
    const latest = await getFirst("employees", { _id: employee._id });
    return ok({ passed: false, text: recognition.text, score: comparison.score, completedCount, maxRewardedAttempts, goldenBeans: Number(latest?.goldenBeans || 0) });
  }

  const shouldCountCompletion = completedCount < maxRewardedAttempts;
  let nextCompletedCount = completedCount;
  let award = { awarded: false, delta: 0, practiceOnly: true };
  if (shouldCountCompletion) {
    nextCompletedCount += 1;
    award = await addCappedGoldenBeans({
      employeeId: employee._id,
      sourceType: "phrase",
      sourceId: `${phraseId}-${nextCompletedCount}`,
      productKey: phraseProductKey,
      delta: Number(phrase.goldenBeans || 0),
      reason: `金句开口说：${phrase.title}（第 ${nextCompletedCount} 遍）`,
      createdBy: "employee-web",
      productCap: await productRewardCap(phraseProductKey)
    });
  }
  try {
    await addDocument("phrasePracticeAttempts", {
      ...attemptRecord,
      counted: shouldCountCompletion,
      goldenBeans: Number(award.delta || 0)
    });
  } catch (error) {
    if (!award.ledger) throw error;
    console.error("[employeeWeb-phrase-attempt] reward ledger preserved completion", error.message);
  }
  const latest = await getFirst("employees", { _id: employee._id });
  return ok({
    passed: true,
    text: recognition.text,
    score: comparison.score,
    completedCount: nextCompletedCount,
    maxRewardedAttempts,
    award,
    goldenBeans: Number(latest?.goldenBeans || 0)
  });
}

async function redeemAction(payload) {
  const { employee } = await getBoundContext(payload);
  const readOnlyError = assertSupplierReadOnly(employee);
  if (readOnlyError) return readOnlyError;
  const rewardId = requireString(payload.rewardId, "rewardId");
  const redemption = await db.runTransaction(async (transaction) => {
    const [employeeResult, rewardResult] = await Promise.all([
      transaction.collection("employees").where({ _id: employee._id, status: "active" }).limit(1).get(),
      transaction.collection("rewards").where({ _id: rewardId, status: "active", nonDrugConfirmed: true }).limit(1).get()
    ]);
    const currentEmployee = employeeResult.data?.[0];
    const reward = rewardResult.data?.[0];
    if (!currentEmployee) throw Object.assign(new Error("员工资料不存在"), { code: "EMPLOYEE_ACCOUNT_INVALID" });
    if (!reward) throw Object.assign(new Error("奖励不存在或已下架"), { code: "REWARD_NOT_FOUND" });
    const cost = Number(reward.goldenBeanPrice || 0);
    const currentBalance = Number(currentEmployee.goldenBeans || 0);
    if (!Number.isFinite(cost) || cost < 0) throw Object.assign(new Error("奖励所需金豆配置不正确"), { code: "INVALID_REWARD_PRICE" });
    if (!Number.isFinite(currentBalance) || currentBalance < 0) throw Object.assign(new Error("员工金豆余额异常，请联系管理员"), { code: "INVALID_GOLDEN_BEAN_BALANCE" });
    if (currentBalance < cost) throw Object.assign(new Error("金豆不足"), { code: "INSUFFICIENT_GOLDEN_BEANS" });
    const stock = Number(reward.stock || 0);
    if (!Number.isFinite(stock) || stock <= 0) throw Object.assign(new Error("库存不足"), { code: "OUT_OF_STOCK" });
    const createdAt = now();
    const result = await addDocument("redemptions", { employeeId: employee._id, rewardId: reward._id || rewardId, goldenBeanCost: cost, status: "pending", createdAt }, transaction);
    await transaction.collection("employees").doc(employee._id).update({ goldenBeans: command.inc(-cost) });
    await transaction.collection("rewards").doc(rewardId).update({ stock: command.inc(-1) });
    await addDocument("goldenBeanLedger", { employeeId: employee._id, sourceType: "redemption", sourceId: result.id, delta: -cost, reason: `兑换奖励：${reward.title}`, createdBy: "employee-web", createdAt }, transaction);
    return { redemptionId: result.id, goldenBeanCost: cost, goldenBeans: currentBalance - cost };
  });
  return ok(redemption);
}

async function redeemStoreTaskRewardAction(payload) {
  const { employee } = await getBoundContext(payload);
  if (employee.role === "supplier") return assertSupplierReadOnly(employee);
  if (employee.role === "admin") return fail("总部账号不能使用门店领取额度", "STORE_TASK_REWARD_ROLE_FORBIDDEN");
  const rewardId = requireString(payload.storeTaskRewardId || payload.rewardId, "storeTaskRewardId");
  try {
    const redemption = await db.runTransaction(async (transaction) => {
      const [employeeResult, rewardResult] = await Promise.all([
        transaction.collection("employees").where({ _id: employee._id, status: "active" }).limit(1).get(),
        transaction.collection("storeTaskRewards").where({ _id: rewardId, status: "active" }).limit(1).get()
      ]);
      const currentEmployee = employeeResult.data?.[0];
      const configuredReward = rewardResult.data?.[0];
      if (!currentEmployee || !isAllowlistedEmployee(currentEmployee)) throw Object.assign(new Error("员工资料不存在或已停用"), { code: "EMPLOYEE_ACCOUNT_INVALID" });
      if (currentEmployee.role === "supplier" || currentEmployee.role === "admin") throw Object.assign(new Error("该账号不能使用门店领取额度"), { code: "STORE_TASK_REWARD_ROLE_FORBIDDEN" });
      if (!configuredReward) throw Object.assign(new Error("门店任务兑换品不存在或已停用"), { code: "STORE_TASK_REWARD_NOT_FOUND" });
      const [storeResult, saleResult] = await Promise.all([
        transaction.collection("stores").where({ _id: currentEmployee.storeId }).limit(1).get(),
        transaction.collection("storeProductSales").where({
          storeId: currentEmployee.storeId,
          productKey: configuredReward.productKey,
          periodKey: currentPeriodKey()
        }).limit(1).get()
      ]);
      const store = storeResult.data?.[0];
      const sale = saleResult.data?.[0];
      const currentPeriod = currentPeriodKey();
      const claimsResult = await transaction.collection("redemptions").where({
        redemptionType: "storeTaskReward",
        storeId: currentEmployee.storeId,
        productKey: configuredReward.productKey,
        periodKey: currentPeriod
      }).limit(1000).get();
      const claims = claimsResult.data || [];
      const quota = calculateStoreTaskRewardQuota({
        employee: currentEmployee,
        store: store || {},
        reward: { ...normalizeId(configuredReward), threshold: 10 },
        sales: sale ? [sale] : [],
        claims,
        periodKey: currentPeriod
      });
      if (!quota.eligible) throw Object.assign(new Error("当前员工或门店不符合任务兑换条件"), { code: "STORE_TASK_REWARD_FORBIDDEN" });
      if (quota.availableCount <= 0) throw Object.assign(new Error(`本店当前没有可领取额度（完成 ${quota.completedQuantity} 盒，已使用 ${quota.claimedCount} 次；每完成 ${quota.threshold} 盒可领取 1 次）`), { code: "STORE_TASK_REWARD_QUOTA_EXHAUSTED" });
      const claimNumber = quota.claimedCount + 1;
      const redemptionId = buildStoreTaskRewardClaimId({
        storeId: currentEmployee.storeId,
        productKey: quota.productKey,
        periodKey: currentPeriod,
        claimNumber
      });
      const createdAt = now();
      const redemption = {
        redemptionType: "storeTaskReward",
        rewardId: configuredReward._id || rewardId,
        storeTaskRewardId: configuredReward._id || rewardId,
        rewardTitle: quota.reward.title,
        rewardValue: quota.reward.itemValue,
        threshold: quota.threshold,
        storeId: currentEmployee.storeId,
        storeName: quota.storeName,
        productKey: quota.productKey,
        periodKey: currentPeriod,
        claimNumber,
        employeeId: currentEmployee._id,
        goldenBeanCost: 0,
        status: "pending",
        createdAt
      };
      await transaction.collection("redemptions").doc(redemptionId).set(redemption);
      return {
        redemptionId,
        claimNumber,
        storeId: currentEmployee.storeId,
        storeName: quota.storeName,
        productKey: quota.productKey,
        periodKey: currentPeriod,
        availableCount: quota.availableCount - 1,
        completedQuantity: quota.completedQuantity,
        threshold: quota.threshold,
        goldenBeansChanged: false
      };
    });
    return ok(redemption);
  } catch (error) {
    return fail(error.message || "门店任务兑换失败", error.code || "STORE_TASK_REWARD_REDEEM_FAILED");
  }
}

async function addCommentAction(payload) {
  const { session, employee } = await getBoundContext(payload);
  const readOnlyError = assertSupplierReadOnly(employee);
  if (readOnlyError) return readOnlyError;
  const caseId = requireString(payload.caseId, "caseId");
  const content = requireString(payload.content, "content");
  if (content.length > 500) return fail("评论不能超过 500 个字", "COMMENT_TOO_LONG");
  const post = await getFirst("cases", { _id: caseId });
  if (!post || post.deletedAt || post.status === "deleted" || !["approved", "published"].includes(post.status)) return fail("案例不存在", "CASE_NOT_FOUND");
  if (!supplierCanViewCase(employee, post)) return fail("当前供应商账号未授权查看该案例", "SUPPLIER_PRODUCT_FORBIDDEN");
  if (shouldRunWechatContentSecurity({ openId: session.openId, appId: oaAppId, appSecret: oaAppSecret })) {
    await assertTextSafe({ content, openId: session.openId, scene: 4, appId: oaAppId, appSecret: oaAppSecret });
  }
  const result = await addDocument("caseComments", { caseId, employeeId: employee._id, storeId: employee.storeId, content, createdAt: now() });
  await db.collection("cases").doc(caseId).update({ commentCount: command.inc(1), updatedAt: now() });
  return ok({ commentId: result.id });
}

async function acknowledgeCaseAction(payload) {
  const { employee } = await getBoundContext(payload);
  const readOnlyError = assertSupplierReadOnly(employee);
  if (readOnlyError) return readOnlyError;
  const caseId = requireString(payload.caseId, "caseId");
  const post = await getFirst("cases", { _id: caseId });
  const legacyAdminNotice = isLegacyAdminNotice(post || {});
  if (!post || (!isAcknowledgementCase(post) && !legacyAdminNotice)) {
    return fail("该案例不需要确认或已停止发布", "CASE_ACKNOWLEDGEMENT_NOT_REQUIRED");
  }
  let recipient = await getOptionalFirst("caseAcknowledgements", { caseId, employeeId: employee._id });
  // Older acknowledgement-required cases may predate the administrator
  // recipient snapshot. Create the admin's row on first confirmation so the
  // existing notice can still be received without changing other recipients.
  if (!recipient && employee.role === "admin") {
    await ensureCollectionExists("caseAcknowledgements");
    const key = `${caseId}:${employee._id}`;
    const documentId = acknowledgementDocumentId(key);
    const recipientDocument = {
      key,
      caseId,
      employeeId: employee._id,
      status: "pending",
      acknowledgedAt: "",
      createdAt: now()
    };
    await db.collection("caseAcknowledgements").doc(documentId).set(recipientDocument);
    recipient = { _id: documentId, ...recipientDocument };
  }
  if (!recipient) {
    return fail("你不在该通知的接收名单中", "CASE_ACKNOWLEDGEMENT_NOT_ASSIGNED");
  }
  if (recipient.status === "acknowledged" || recipient.acknowledgedAt) {
    return ok({ caseId, acknowledgedAt: recipient.acknowledgedAt || "", message: "已确认收到" });
  }
  const acknowledgedAt = now();
  const updated = acknowledgeRecipient(recipient, acknowledgedAt);
  await db.collection("caseAcknowledgements").doc(recipient._id || recipient.id).update({
    status: updated.status,
    acknowledgedAt: updated.acknowledgedAt,
    updatedAt: updated.updatedAt
  });
  return ok({ caseId, acknowledgedAt, message: "已确认收到" });
}

async function updateProfileAction(payload) {
  await getBoundContext(payload);
  return fail("员工姓名和所属门店由总部统一维护，如需修改请联系总部管理员。", "EMPLOYEE_PROFILE_MANAGED_BY_ADMIN");
}

async function logoutAction(payload) {
  const session = await getSession(payload);
  await db.collection("webSessions").doc(session._id).update({ status: "inactive", updatedAt: now() });
  return ok({ loggedOut: true });
}

async function handleAction(payload) {
  switch (payload.action) {
    case "entryData": return entryDataAction(payload);
    case "authUrl": return authUrlAction(payload);
    case "manualSession": return manualSessionAction(payload);
    case "directLogin": return directLoginAction(payload);
    case "oauth": return oauthAction(payload);
    case "session": return sessionAction(payload);
    case "bind": return bindAction(payload);
    case "employeeApplicationStatus": return applicationStatusAction(payload);
    case "data": return dataAction(payload);
    case "notificationPreference": return notificationPreferenceAction(payload);
    case "courseDetail": return courseDetailAction(payload);
    case "syncVideoProgress": return syncVideoProgressAction(payload);
    case "pptProgress": return pptProgressAction(payload);
    case "startPptSlide": return startPptSlideAction(payload);
    case "completePptSlide": return completePptSlideAction(payload);
    case "completeCourse": return completeCourseAction(payload);
    case "submitExam": return submitExamAction(payload);
    case "submitContent": return submitContentAction(payload);
    case "uploadMedia": return uploadMediaAction(payload);
    case "submitStoreReceipt": return submitStoreReceiptAction(payload);
    case "acceptRecordingNotice": return acceptRecordingNoticeAction(payload);
    case "deleteRecording": return deleteRecordingAction(payload);
    case "recognizePhrase": return recognizePhraseAction(payload);
    case "addComment": return addCommentAction(payload);
    case "acknowledgeCase": return acknowledgeCaseAction(payload);
    case "redeemReward": return redeemAction(payload);
    case "redeemStoreTaskReward": return redeemStoreTaskRewardAction(payload);
    case "updateProfile": return updateProfileAction(payload);
    case "logout": return logoutAction(payload);
    default: return fail("不支持的操作", "INVALID_ACTION");
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return sendJson(req, res, { ok: true, service: "employeeWeb", mode: "local-test", message: "后端进程已启动；业务接口需要 CloudBase 运行时凭证" }, 200);
  }
  if (req.method === "OPTIONS") return sendJson(req, res, {}, 204);
  if (req.method !== "POST") return sendJson(req, res, fail("Only POST requests are supported", "METHOD_NOT_ALLOWED"), 405);
  let payload = {};
  try {
    payload = await readJson(req);
    const result = await handleAction(payload);
    sendJson(req, res, result, result.ok ? 200 : 400);
  } catch (error) {
    console.error("[employeeWeb-error]", { action: payload.action || "unknown", code: error.code || "EMPLOYEE_WEB_FAILED", message: error.message, clientContext: requestClientContext(payload) });
    sendJson(req, res, fail(error.message, error.code || "EMPLOYEE_WEB_FAILED"), error.code ? 400 : 500);
  }
});

server.listen(9000, "0.0.0.0", () => {
  console.log("employeeWeb HTTP function listening on port 9000");
});
