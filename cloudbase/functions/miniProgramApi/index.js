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
const { compareSpeechText, recognizeAudio } = require("./speech");
const {
  assertImageSafe,
  assertTextSafe,
  requiresImageSecurityCheck
} = require("./contentSecurity");
const {
  DEFAULT_PRODUCT_REWARD_CAP,
  nonNegativeInteger,
  phraseAttemptLimit
} = require("./_shared/rewardRules");

const wxAppId = process.env.WX_APPID || "wxa9cacea36bc93f02";
const wxAppSecret = process.env.WX_APP_SECRET || "";
const allowDebugOpenId = process.env.ALLOW_DEBUG_OPENID === "true";

const collectionByType = {
  pop: "popSubmissions",
  phrase: "phraseSubmissions",
  case: "cases"
};

const defaultGoldenBeans = {
  pop: 0,
  phrase: 0,
  case: 0
};

const maxUploadBytes = 80 * 1024 * 1024;
const casePageSize = 10;

function sendJson(res, body, statusCode = 200) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Accept",
    "access-control-max-age": "86400"
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

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function normalizeId(item = {}) {
  const { _id, inviteCode, ...rest } = item;
  return {
    ...rest,
    id: item.id || _id
  };
}

function publicEmployee(employee = {}) {
  const { inviteCode, ...safeEmployee } = employee;
  return safeEmployee;
}

function optionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function productKeyOf(item = {}) {
  return optionalString(item.productId || item.productName || item.productKey || item._id || item.id);
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(optionalString(value));
}

function isCloudFileId(value) {
  return /^(cloud|cloudbase):\/\//i.test(optionalString(value));
}

async function getTempFileURL(fileId) {
  if (!fileId) {
    return "";
  }

  try {
    const result = await app.getTempFileURL({
      fileList: [fileId]
    });
    const file = result?.fileList?.[0] || {};
    return optionalString(file.tempFileURL || file.tempFileUrl || file.url || file.download_url);
  } catch (error) {
    console.error("[miniProgramApi] 获取文件临时链接失败", error);
    return "";
  }
}

async function getTempFileURLs(fileIds = []) {
  const uniqueFileIds = [...new Set(fileIds.filter(Boolean))];
  if (uniqueFileIds.length === 0) {
    return {};
  }

  try {
    const result = await app.getTempFileURL({ fileList: uniqueFileIds });
    return (result?.fileList || []).reduce((urls, file, index) => {
      const fileId = file.fileID || file.fileId || uniqueFileIds[index];
      const url = optionalString(file.tempFileURL || file.tempFileUrl || file.url || file.download_url);
      if (fileId && url) {
        urls[fileId] = url;
      }
      return urls;
    }, {});
  } catch (error) {
    console.error("[miniProgramApi] 批量获取文件临时链接失败", error);
    return {};
  }
}

async function resolveAssetUrl(value) {
  const rawValue = optionalString(value);
  if (!rawValue) {
    return "";
  }
  if (isHttpUrl(rawValue) || /^wxfile:\/\//i.test(rawValue)) {
    return rawValue;
  }
  if (isCloudFileId(rawValue)) {
    return await getTempFileURL(rawValue);
  }
  return rawValue;
}

async function publicEmployeeWithAvatar(employee = {}) {
  const safeEmployee = publicEmployee(employee);
  const savedAvatarUrl = optionalString(safeEmployee.avatarUrl);
  const avatarFileId = optionalString(safeEmployee.avatarFileId) || (isCloudFileId(savedAvatarUrl) ? savedAvatarUrl : "");
  const resolvedAvatarUrl = avatarFileId ? await getTempFileURL(avatarFileId) : "";
  const avatarUrl = resolvedAvatarUrl || savedAvatarUrl;

  return {
    ...safeEmployee,
    avatarFileId,
    avatarUrl: isHttpUrl(avatarUrl) || /^wxfile:\/\//i.test(avatarUrl) ? avatarUrl : ""
  };
}

async function publicEmployeesWithAvatars(employees = []) {
  const avatarFileIds = employees.map((employee) => {
    const avatarUrl = optionalString(employee.avatarUrl);
    return optionalString(employee.avatarFileId) || (isCloudFileId(avatarUrl) ? avatarUrl : "");
  }).filter(Boolean);
  const tempUrls = await getTempFileURLs(avatarFileIds);

  return employees.map((employee) => {
    const safeEmployee = publicEmployee(employee);
    const savedAvatarUrl = optionalString(safeEmployee.avatarUrl);
    const avatarFileId = optionalString(safeEmployee.avatarFileId)
      || (isCloudFileId(savedAvatarUrl) ? savedAvatarUrl : "");
    const avatarUrl = (avatarFileId ? tempUrls[avatarFileId] : "") || savedAvatarUrl;

    return {
      ...safeEmployee,
      avatarFileId,
      avatarUrl: isHttpUrl(avatarUrl) || /^wxfile:\/\//i.test(avatarUrl) ? avatarUrl : ""
    };
  });
}

async function publicCourseWithAssets(course = {}) {
  const productImageRaw = optionalString(course.productImage || course.productImageUrl);
  const coverImageRaw = optionalString(course.coverImage || course.coverImageUrl);
  const videoUrlRaw = optionalString(course.videoUrl || course.videoFileId);
  const [productImage, coverImage, videoUrl] = await Promise.all([
    resolveAssetUrl(productImageRaw),
    resolveAssetUrl(coverImageRaw),
    resolveAssetUrl(videoUrlRaw)
  ]);

  return {
    ...course,
    productImage,
    productImageUrl: productImage,
    coverImage,
    coverImageUrl: coverImage,
    videoUrl,
    videoFileId: isCloudFileId(videoUrlRaw) ? videoUrlRaw : optionalString(course.videoFileId)
  };
}

function assetUrlFromMap(value, tempUrls) {
  const rawValue = optionalString(value);
  if (!rawValue) {
    return "";
  }
  if (isCloudFileId(rawValue)) {
    return tempUrls[rawValue] || "";
  }
  return rawValue;
}

async function publicCourseListWithAssets(courses = []) {
  const imageFileIds = courses.flatMap((course) => [
    course.productImage || course.productImageUrl,
    course.coverImage || course.coverImageUrl,
    course.resourceFileId || course.resourceUrl
  ]).filter(isCloudFileId);
  const tempUrls = await getTempFileURLs(imageFileIds);

  return courses.map((course) => {
    const productImageRaw = optionalString(course.productImage || course.productImageUrl);
    const coverImageRaw = optionalString(course.coverImage || course.coverImageUrl);
    const resourceRaw = optionalString(course.resourceFileId || course.resourceUrl);
    const hasVideo = Boolean(optionalString(course.videoUrl || course.videoFileId));
    const productImage = assetUrlFromMap(productImageRaw, tempUrls);
    const coverImage = assetUrlFromMap(coverImageRaw, tempUrls);

    return {
      ...course,
      productImage,
      productImageUrl: productImage,
      coverImage,
      coverImageUrl: coverImage,
      hasVideo,
      videoUrl: "",
      videoFileId: "",
      resourceType: ["pdf", "ppt", "doc", "video-link"].includes(course.resourceType) ? course.resourceType : "",
      resourceUrl: assetUrlFromMap(resourceRaw, tempUrls),
      resourceFileId: isCloudFileId(resourceRaw) ? resourceRaw : "",
      resourceName: optionalString(course.resourceName),
      resourceContentType: optionalString(course.resourceContentType)
    };
  });
}

async function publicRewardWithAssets(reward = {}) {
  const imageUrl = await resolveAssetUrl(reward.imageUrl);

  return {
    ...reward,
    imageUrl
  };
}

function normalizeQuestionAnswerIndexes(question = {}) {
  if (question.type === "multiple") {
    return (Array.isArray(question.answerIndexes) ? question.answerIndexes : [])
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
  }

  return [Number(question.answerIndex || 0)];
}

function normalizeSubmittedAnswer(answer) {
  if (Array.isArray(answer?.selectedIndexes)) {
    return answer.selectedIndexes
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
  }
  if (Number.isFinite(Number(answer))) {
    return [Number(answer)];
  }
  return [];
}

function sameIndexes(a, b) {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function publicQuestion(question = {}) {
  return {
    id: question.id || question._id,
    prompt: question.prompt || "",
    options: Array.isArray(question.options) ? question.options : [],
    type: question.type === "multiple" ? "multiple" : "single",
    sortOrder: Number(question.sortOrder || 999)
  };
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
  if (contentType.includes("mpeg")) return "mp3";
  if (contentType.includes("mp4")) return "mp4";
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("amr")) return "amr";

  return "dat";
}

function safeFolderName(value) {
  const folder = optionalString(value) || "uploads";
  const safeFolder = folder
    .replace(/\\/g, "/")
    .replace(/[^0-9a-zA-Z/_-]/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "");

  return safeFolder || "uploads";
}

async function getJson(url) {
  const response = await fetch(url);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(`WeChat API HTTP ${response.status}`);
  }

  return body;
}

async function exchangeOpenId(code) {
  if (allowDebugOpenId && process.env.DEBUG_OPENID) {
    return process.env.DEBUG_OPENID;
  }

  if (!wxAppSecret) {
    const error = new Error("需要先在腾讯云函数 miniProgramApi 配置 WX_APP_SECRET");
    error.code = "WX_APP_SECRET_REQUIRED";
    throw error;
  }

  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", wxAppId);
  url.searchParams.set("secret", wxAppSecret);
  url.searchParams.set("js_code", requireString(code, "code"));
  url.searchParams.set("grant_type", "authorization_code");

  const body = await getJson(url.toString());
  if (!body.openid) {
    const error = new Error(body.errmsg || "微信登录换取 openid 失败");
    error.code = `WECHAT_${body.errcode || "NO_OPENID"}`;
    throw error;
  }

  return body.openid;
}

async function requireOpenId(payload) {
  if (allowDebugOpenId && payload.openId) {
    return requireString(payload.openId, "openId");
  }

  return exchangeOpenId(payload.code);
}

async function getCollection(collectionName, limit = 100) {
  const result = await db.collection(collectionName).limit(limit).get();
  return (result.data || []).map(normalizeId);
}

async function getWhereCollection(collectionName, where, limit = 100) {
  const result = await db.collection(collectionName).where(where).limit(limit).get();
  return (result.data || []).map(normalizeId);
}

async function getTaskRewards() {
  try {
    const rewards = await getCollection("taskRewards");
    return {
      ...defaultGoldenBeans,
      ...rewards.reduce((next, item) => ({
        ...next,
        [item.id]: nonNegativeInteger(item.goldenBeans, defaultGoldenBeans[item.id] ?? 0)
      }), {})
    };
  } catch (error) {
    return { ...defaultGoldenBeans };
  }
}

async function getProductRewardRules() {
  try {
    return await getCollection("productRewardRules");
  } catch (error) {
    return [];
  }
}

async function getProductRewardCap(productKey) {
  if (!productKey) {
    return DEFAULT_PRODUCT_REWARD_CAP;
  }

  const directRule = await getFirst("productRewardRules", { _id: productKey }).catch(() => null);
  const rule = directRule || await getFirst("productRewardRules", {
    productKey,
    status: "active"
  }).catch(() => null);

  if (!rule || rule.status === "inactive") {
    return DEFAULT_PRODUCT_REWARD_CAP;
  }
  return nonNegativeInteger(rule.rewardCap, DEFAULT_PRODUCT_REWARD_CAP);
}

async function findStore(storeName) {
  const storeResult = await db.collection("stores").limit(100).get();
  const stores = storeResult.data || [];
  const normalizedStoreName = normalizeText(storeName);
  const exactMatches = stores.filter((store) => normalizeText(store.name) === normalizedStoreName);
  const fuzzyMatches = stores.filter((store) => {
    const normalizedName = normalizeText(store.name);
    return normalizedName.includes(normalizedStoreName) || normalizedStoreName.includes(normalizedName);
  });
  const matches = exactMatches.length > 0 ? exactMatches : fuzzyMatches;

  if (matches.length === 0) {
    return {
      error: fail("没有找到这个门店，请确认店名是否和后台一致", "STORE_NOT_FOUND")
    };
  }
  if (matches.length > 1) {
    return {
      error: fail("找到多个相似门店，请填写完整店名", "STORE_AMBIGUOUS")
    };
  }

  return { store: matches[0] };
}

async function findStoreById(storeId) {
  const id = requireString(storeId, "storeId");
  const store = await getFirst("stores", { _id: id });

  if (!store) {
    return {
      error: fail("没有找到这个门店，请重新选择", "STORE_NOT_FOUND")
    };
  }

  return { store };
}

async function findOrCreateEmployeeByStoreAndName(store, employeeName) {
  const storeId = store._id || store.id;
  const displayName = requireString(employeeName, "employeeName");
  const employeeResult = await db.collection("employees").where({
    storeId,
    status: "active"
  }).limit(100).get();
  const employees = employeeResult.data || [];
  const normalizedEmployeeName = normalizeText(displayName);
  const exactMatches = employees.filter((employee) => normalizeText(employee.name) === normalizedEmployeeName);
  const fuzzyMatches = employees.filter((employee) => {
    const normalizedName = normalizeText(employee.name);
    return normalizedName.includes(normalizedEmployeeName) || normalizedEmployeeName.includes(normalizedName);
  });
  const matches = exactMatches.length > 0 ? exactMatches : fuzzyMatches;

  if (matches.length > 0) {
    return { employee: matches[0] };
  }

  const employee = {
    name: displayName,
    employeeNo: `AUTO-${Date.now()}`,
    role: "employee",
    storeId,
    regionId: store.regionId || "",
    goldenBeans: 0,
    courseCompletionRate: 0,
    examPassRate: 0,
    avatarUrl: "",
    status: "active",
    source: "self_login",
    createdAt: now(),
    updatedAt: now()
  };
  const addResult = await db.collection("employees").add(employee);

  return {
    employee: {
      _id: addResult.id,
      ...employee
    }
  };
}

async function getEmployeeContext(openId, options = {}) {
  if (!openId) {
    return null;
  }

  const user = await getFirst("users", { openId, status: "active" });
  if (!user) {
    return null;
  }

  const employee = await getFirst("employees", { _id: user.employeeId, status: "active" });
  if (!employee) {
    return null;
  }

  const resolveAvatar = options.resolveAvatar !== false;
  const resolveStore = options.resolveStore !== false;
  const resolveRegion = options.resolveRegion !== false;
  const normalizedEmployee = normalizeId(employee);
  const [store, region, safeEmployee] = await Promise.all([
    resolveStore && employee.storeId ? getFirst("stores", { _id: employee.storeId }) : null,
    resolveRegion && employee.regionId ? getFirst("regions", { _id: employee.regionId }) : null,
    resolveAvatar
      ? publicEmployeeWithAvatar(normalizedEmployee)
      : Promise.resolve({
          ...publicEmployee(normalizedEmployee),
          avatarFileId: "",
          avatarUrl: ""
        })
  ]);

  return {
    user: normalizeId(user),
    employee: {
      ...safeEmployee,
      store: store?.name || "",
      region: region?.name || ""
    }
  };
}

async function requireBoundUser(openId) {
  const user = await getFirst("users", { openId, status: "active" });
  if (!user) {
    const error = new Error("请先登录");
    error.code = "USER_NOT_BOUND";
    throw error;
  }

  return user;
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

  const legacyFileId = optionalString(item.fileId);
  const legacyImageUrl = optionalString(item.imageUrl);
  return legacyFileId || legacyImageUrl
    ? [{ fileId: legacyFileId, imageUrl: legacyImageUrl, width: 0, height: 0, size: 0 }]
    : [];
}

function caseSortKey(item = {}) {
  return `${optionalString(item.createdAt)}::${optionalString(item.id || item._id)}`;
}

function isVisibleRecord(item = {}) {
  return !item.deletedAt && item.status !== "deleted";
}

async function loadCaseFeed(payload, options = {}) {
  const openId = options.openId || await requireOpenId(payload);
  const currentUser = options.employeeContext?.user || await requireBoundUser(openId);
  const currentEmployee = options.employeeContext?.employee
    || await getFirst("employees", { _id: currentUser.employeeId, status: "active" });
  const requestedPageSize = Number(payload.pageSize || casePageSize);
  const pageSize = Math.min(Math.max(requestedPageSize, 1), 20);
  const cursor = optionalString(payload.cursor);

  const cases = await getCollection("cases", 1000);

  const sortedCases = cases
    .filter(isVisibleRecord)
    .filter((item) => item.status === "approved")
    .filter((item) => !cursor || caseSortKey(item) < cursor)
    .sort((a, b) => caseSortKey(b).localeCompare(caseSortKey(a)));
  const pageRecords = sortedCases.slice(0, pageSize);
  const hasMore = sortedCases.length > pageSize;
  const employeeIds = new Set(pageRecords.map((item) => item.employeeId).filter(Boolean));
  const storeIds = new Set(pageRecords.map((item) => item.storeId).filter(Boolean));
  const [employees, stores] = await Promise.all([
    employeeIds.size > 0 ? getCollection("employees", 1000) : [],
    storeIds.size > 0 ? getCollection("stores", 1000) : []
  ]);
  const relevantEmployees = employees.filter((item) => employeeIds.has(item.id));
  const publicEmployees = await publicEmployeesWithAvatars(relevantEmployees);
  const employeeMap = Object.fromEntries(publicEmployees.map((employee) => [employee.id, employee]));
  const storeMap = Object.fromEntries(stores.map((store) => [store.id, store]));
  const currentEmployeeId = currentEmployee?.id || currentEmployee?._id || currentUser.employeeId;
  const canManageCases = currentUser.role === "admin" || currentEmployee?.role === "admin";
  const allImages = pageRecords.flatMap(normalizeCaseImages);
  const includeMotionMedia = payload.mediaMode !== "images";
  const videoFileIds = includeMotionMedia ? pageRecords.map((item) => (
    optionalString(item.videoFileId)
      || (isCloudFileId(item.videoUrl) ? optionalString(item.videoUrl) : "")
  )).filter(Boolean) : [];
  const mediaUrls = await getTempFileURLs([
    ...allImages.map((image) => image.fileId),
    ...videoFileIds
  ]);

  const items = pageRecords.map((item) => {
    const employee = employeeMap[item.employeeId] || {};
    const rawVideoUrl = optionalString(item.videoUrl);
    const videoFileId = optionalString(item.videoFileId)
      || (isCloudFileId(rawVideoUrl) ? rawVideoUrl : "");
    const videoUrl = videoFileId ? mediaUrls[videoFileId] || "" : rawVideoUrl;

    return {
      ...item,
      id: item.id,
      title: item.title || "案例分享",
      content: item.content || "",
      goldenBeans: Number(item.goldenBeans ?? 0),
      images: normalizeCaseImages(item).map((image) => ({
        ...image,
        url: image.fileId ? mediaUrls[image.fileId] || image.imageUrl : image.imageUrl
      })),
      video: includeMotionMedia && videoUrl
        ? {
            fileId: videoFileId,
            url: videoUrl,
            duration: Number(item.videoDuration || 0),
            width: Number(item.videoWidth || 0),
            height: Number(item.videoHeight || 0),
            size: Number(item.videoSize || 0)
          }
        : null,
      employee: {
        id: employee.id || item.employeeId,
        name: employee.name || item.publisherName || "学习运营台",
        avatarUrl: employee.avatarUrl || "",
        store: item.publisherRole === "admin"
          ? "官方案例"
          : storeMap[item.storeId]?.name || employee.store || ""
      },
      publisherName: item.publisherName || employee.name || "学习运营台",
      isOwner: Boolean(item.employeeId && item.employeeId === currentEmployeeId),
      canDelete: Boolean(canManageCases && item.employeeId && item.employeeId === currentEmployeeId),
      liked: false,
      likeCount: 0,
      commentCount: 0,
      comments: []
    };
  });

  return ok({
    items,
    hasMore,
    nextCursor: hasMore && pageRecords.length > 0 ? caseSortKey(pageRecords[pageRecords.length - 1]) : "",
    canPublish: canManageCases
  });
}

async function createCasePost(payload) {
  const openId = await requireOpenId(payload);
  const user = await requireBoundUser(openId);
  const employee = await getFirst("employees", { _id: user.employeeId, status: "active" });
  if (!employee || (user.role !== "admin" && employee.role !== "admin")) {
    return fail("只有管理员可以发布案例动态", "ADMIN_REQUIRED");
  }

  const content = optionalString(payload.content);
  const rawImages = Array.isArray(payload.images) ? payload.images : [];
  if (rawImages.length > 9) {
    return fail("每条动态最多上传 9 张图片", "CASE_IMAGE_LIMIT");
  }
  const images = normalizeCaseImages({ images: rawImages });
  const rawVideoUrl = optionalString(payload.videoUrl);
  const videoFileId = optionalString(payload.videoFileId)
    || (isCloudFileId(rawVideoUrl) ? rawVideoUrl : "");
  const videoUrl = videoFileId ? "" : rawVideoUrl;

  if (images.length > 0 && (videoFileId || videoUrl)) {
    return fail("一条动态请选择图片或视频其中一种", "CASE_MEDIA_CONFLICT");
  }
  if (!content && images.length === 0 && !videoFileId && !videoUrl) {
    return fail("请填写文字或选择图片、视频", "CASE_CONTENT_REQUIRED");
  }
  if (content.length > 2000) {
    return fail("动态文字不能超过 2000 字", "CASE_CONTENT_TOO_LONG");
  }
  await assertTextSafe({
    content,
    openId,
    scene: 4,
    appId: wxAppId,
    appSecret: wxAppSecret
  });

  const caseRecord = {
    type: "case",
    title: optionalString(payload.title) || (content ? content.slice(0, 32) : "案例动态"),
    content,
    images,
    videoFileId,
    videoUrl,
    videoDuration: Number(payload.videoDuration || 0),
    videoWidth: Number(payload.videoWidth || 0),
    videoHeight: Number(payload.videoHeight || 0),
    videoSize: Number(payload.videoSize || 0),
    employeeId: user.employeeId,
    storeId: employee.storeId || "",
    regionId: employee.regionId || "",
    publisherName: "学习运营台",
    publisherRole: "admin",
    status: "approved",
    goldenBeans: 0,
    createdBy: user.employeeId,
    reviewedBy: user.employeeId,
    reviewedAt: now(),
    createdAt: now(),
    updatedAt: now()
  };
  const result = await db.collection("cases").add(caseRecord);

  return ok({
    caseId: result.id,
    case: { id: result.id, ...caseRecord }
  });
}

async function toggleCaseLike(payload) {
  return fail("案例互动已关闭", "CASE_INTERACTION_DISABLED");
}

async function addCaseComment(payload) {
  return fail("案例评论已关闭", "CASE_COMMENT_DISABLED");
}

async function deleteCasePost(payload) {
  const openId = await requireOpenId(payload);
  const user = await requireBoundUser(openId);
  const employee = await getFirst("employees", { _id: user.employeeId, status: "active" });
  const isAdmin = user.role === "admin" || employee?.role === "admin";
  if (!employee || !isAdmin) {
    return fail("只有管理员可以删除案例动态", "ADMIN_REQUIRED");
  }

  const caseId = requireString(payload.caseId, "caseId");
  const caseItem = await getFirst("cases", { _id: caseId });
  if (!caseItem) {
    return fail("案例动态不存在", "CASE_NOT_FOUND");
  }
  if (caseItem.employeeId !== employee._id) {
    return fail("只能删除自己发布的动态", "CASE_DELETE_FORBIDDEN");
  }
  if (caseItem.deletedAt || caseItem.status === "deleted") {
    return ok({ caseId, deleted: true, alreadyDeleted: true });
  }

  await db.collection("cases").doc(caseId).update({
    deletedAt: now(),
    deletedBy: employee._id,
    updatedAt: now()
  });

  return ok({ caseId, deleted: true, alreadyDeleted: false });
}

async function deleteCaseComment(payload) {
  return fail("员工端评论管理已关闭", "CASE_COMMENT_MANAGEMENT_DISABLED");
}

const scopedEmployeeDataNeeds = {
  home: ["courses", "courseProgress", "stores", "pendingCount"],
  courses: ["courses", "courseProgress"],
  phrases: ["phrases", "phrasePracticeAttempts", "goldenBeanLedger", "productRewardRules"],
  exams: ["exams", "questions", "examAttempts", "goldenBeanLedger"],
  ranking: ["employees", "stores"],
  redemption: ["rewards"],
  profile: ["courses", "courseProgress", "submissions", "goldenBeanLedger", "redemptions", "rewards"],
  profileSettings: ["stores"],
  search: ["courses", "phrases", "exams", "questions", "rewards", "employees", "stores", "submissions"],
  pop: ["popSubmissions", "taskRewards"]
};

const employeeDataBatchScopes = [
  "courses",
  "cases",
  "phrases",
  "exams",
  "ranking",
  "redemption",
  "profile"
];

function employeeDataScope(payload = {}) {
  const scope = optionalString(payload.scope);
  return scopedEmployeeDataNeeds[scope] ? scope : "full";
}

async function getEmployeeRecords(collectionName, employeeId, limit = 1000) {
  if (!employeeId) {
    return [];
  }
  return getWhereCollection(collectionName, { employeeId }, limit).catch(() => []);
}

async function getPendingSubmissionCount(employeeId) {
  if (!employeeId) {
    return 0;
  }

  const collections = ["popSubmissions", "phraseSubmissions", "cases"];
  const counts = await Promise.all(collections.map(async (collectionName) => {
    try {
      const result = await db.collection(collectionName).where({
        employeeId,
        status: "pending"
      }).count();
      return Number(result.total || 0);
    } catch (error) {
      return 0;
    }
  }));
  return counts.reduce((total, count) => total + count, 0);
}

async function loadScopedEmployeeData(payload, scope, options = {}) {
  const openId = options.openId || await requireOpenId(payload);
  const needsFullEmployeeProfile = ["home", "profile", "profileSettings"].includes(scope);
  const employeeContext = options.employeeContext || await getEmployeeContext(openId, {
      resolveAvatar: needsFullEmployeeProfile,
      resolveStore: needsFullEmployeeProfile,
      resolveRegion: scope === "home"
    });
  const employeeId = employeeContext?.employee.id;
  const needs = new Set(scopedEmployeeDataNeeds[scope]);
  const wants = (key) => needs.has(key);

  const [
    courses,
    phrases,
    exams,
    questions,
    rewards,
    employees,
    stores,
    popSubmissions,
    phraseSubmissions,
    cases,
    goldenBeanLedger,
    redemptions,
    examAttempts,
    courseProgress,
    phrasePracticeAttempts,
    taskRewards,
    productRewardRules,
    pendingCount
  ] = await Promise.all([
    wants("courses") ? getWhereCollection("courses", { status: "published" }) : [],
    wants("phrases") ? getWhereCollection("phrases", { status: "published" }) : [],
    wants("exams") ? getWhereCollection("exams", { status: "published" }) : [],
    wants("questions") ? getCollection("questions", 1000) : [],
    wants("rewards") ? getWhereCollection("rewards", { status: "active" }) : [],
    wants("employees") ? getWhereCollection("employees", { status: "active" }, 1000) : [],
    wants("stores") ? getCollection("stores", 1000) : [],
    wants("submissions") || wants("popSubmissions")
      ? getEmployeeRecords("popSubmissions", employeeId)
      : [],
    wants("submissions") ? getEmployeeRecords("phraseSubmissions", employeeId) : [],
    wants("submissions") ? getEmployeeRecords("cases", employeeId) : [],
    wants("goldenBeanLedger") ? getEmployeeRecords("goldenBeanLedger", employeeId) : [],
    wants("redemptions") ? getEmployeeRecords("redemptions", employeeId) : [],
    wants("examAttempts") ? getEmployeeRecords("examAttempts", employeeId) : [],
    wants("courseProgress") ? getEmployeeRecords("courseProgress", employeeId) : [],
    wants("phrasePracticeAttempts") ? getEmployeeRecords("phrasePracticeAttempts", employeeId) : [],
    wants("taskRewards") ? getTaskRewards() : { ...defaultGoldenBeans },
    wants("productRewardRules") ? getProductRewardRules() : [],
    wants("pendingCount") ? getPendingSubmissionCount(employeeId) : 0
  ]);

  const courseProgressById = courseProgress.reduce((next, item) => ({
    ...next,
    [item.courseId]: item
  }), {});
  const rawPublishedCourses = courses.map((course) => {
    const progress = courseProgressById[course.id];
    return {
      ...course,
      progress: Number(progress?.progress || 0),
      completed: Boolean(progress?.completed),
      hasVideo: Boolean(optionalString(course.videoUrl || course.videoFileId))
    };
  });
  const completedCourseCount = rawPublishedCourses.filter((course) => course.completed).length;
  const courseCompletionRate = rawPublishedCourses.length > 0
    ? Math.round((completedCourseCount / rawPublishedCourses.length) * 100)
    : 0;
  let employee = employeeContext?.employee || null;
  if (employee && wants("courseProgress")) {
    employee = {
      ...employee,
      courseCompletionRate: String(courseCompletionRate),
      todayProgress: String(courseCompletionRate)
    };
  }

  const response = {
    bound: Boolean(employeeContext),
    employee
  };

  if (["home", "courses", "search"].includes(scope)) {
    response.courses = scope === "courses"
      ? await publicCourseListWithAssets(rawPublishedCourses)
      : rawPublishedCourses.map((course) => ({
          ...course,
          videoUrl: "",
          videoFileId: "",
          resourceUrl: "",
          resourceFileId: ""
        }));
  }

  if (["home", "profileSettings"].includes(scope)) {
    response.stores = stores.map((store) => ({
      id: store.id,
      name: store.name,
      regionId: store.regionId || ""
    }));
  }

  if (scope === "home") {
    response.pendingCount = pendingCount;
  }

  if (["profile", "search", "pop"].includes(scope)) {
    const sourceSubmissions = scope === "pop"
      ? popSubmissions
      : [...popSubmissions, ...phraseSubmissions, ...cases];
    response.submissions = sourceSubmissions.map((item) => ({
      ...item,
      status: item.status || "pending",
      goldenBeans: Number(item.goldenBeans || 0),
      imageUrl: item.imageUrl || ""
    }));
  }

  if (["phrases", "search"].includes(scope)) {
    const phraseLedger = goldenBeanLedger.filter((item) => (
      item.sourceType === "phrase" && Number(item.delta || 0) > 0
    ));
    response.phrases = phrases.map((phrase) => {
      const maxRewardedAttempts = phraseAttemptLimit(phrase);
      const recordedCount = phrasePracticeAttempts.filter((attempt) => (
        attempt.phraseId === phrase.id && attempt.passed !== false
      )).length;
      const legacyCount = phraseLedger.filter((entry) => (
        entry.sourceId === phrase.id || String(entry.sourceId || "").startsWith(`${phrase.id}-`)
      )).length;

      return {
        ...phrase,
        productName: phrase.productName || phrase.productId || "产品话术",
        maxRewardedAttempts,
        completedCount: Math.min(maxRewardedAttempts, Math.max(recordedCount, legacyCount))
      };
    });
  }

  if (["exams", "search"].includes(scope)) {
    const examAwardedSet = new Set(goldenBeanLedger
      .filter((item) => item.sourceType === "exam" && Number(item.delta || 0) > 0)
      .map((item) => item.sourceId));
    response.exams = exams.map((exam) => {
      const examQuestions = questions
        .filter((question) => question.examId === exam.id)
        .sort((left, right) => Number(left.sortOrder || 999) - Number(right.sortOrder || 999))
        .map(publicQuestion);
      const attempts = examAttempts.filter((attempt) => attempt.examId === exam.id);

      return {
        ...exam,
        questionCount: examQuestions.length || exam.questionIds?.length || 0,
        questions: examQuestions,
        attemptCount: attempts.length,
        bestScore: attempts.reduce((best, attempt) => Math.max(best, Number(attempt.score || 0)), 0),
        completed: attempts.length > 0,
        passed: attempts.some((attempt) => attempt.passed),
        awarded: examAwardedSet.has(exam.id)
      };
    });
  }

  if (["redemption", "profile", "search"].includes(scope)) {
    response.rewards = scope === "redemption"
      ? await Promise.all(rewards.map(publicRewardWithAssets))
      : rewards;
  }

  if (["ranking", "search"].includes(scope)) {
    const publicEmployees = scope === "ranking"
      ? await publicEmployeesWithAvatars(employees)
      : employees.map(publicEmployee);
    response.ranking = publicEmployees.map((rankedEmployee) => {
      const store = stores.find((item) => item.id === rankedEmployee.storeId);
      return {
        ...rankedEmployee,
        store: store?.name || ""
      };
    }).sort((left, right) => Number(right.goldenBeans || 0) - Number(left.goldenBeans || 0));
  }

  if (scope === "profile") {
    response.goldenBeanLedger = goldenBeanLedger;
    response.redemptions = redemptions;
  }
  if (scope === "pop") {
    response.taskRewards = taskRewards;
  }
  if (scope === "phrases") {
    response.productRewardRules = productRewardRules;
  }

  return ok(response);
}

async function loadEmployeeData(payload) {
  const scope = employeeDataScope(payload);
  if (scope === "full") {
    return loadEmployeeDataLegacy(payload);
  }
  return loadScopedEmployeeData(payload, scope);
}

async function loadEmployeeDataBatch(payload) {
  const requestedScopes = Array.isArray(payload.scopes)
    ? payload.scopes.map(optionalString).filter((scope) => employeeDataBatchScopes.includes(scope))
    : employeeDataBatchScopes;
  const scopes = [...new Set(requestedScopes)];
  const openId = await requireOpenId(payload);
  const employeeContext = await getEmployeeContext(openId, {
    resolveAvatar: true,
    resolveStore: true,
    resolveRegion: false
  });

  if (!employeeContext) {
    await requireBoundUser(openId);
  }

  const entries = await Promise.all(scopes.map(async (scope) => {
    const response = scope === "cases"
      ? await loadCaseFeed(
          { ...payload, cursor: "", pageSize: casePageSize },
          { openId, employeeContext }
        )
      : await loadScopedEmployeeData(payload, scope, { openId, employeeContext });
    return [scope, response.data || {}];
  }));

  return ok({ scopes: Object.fromEntries(entries) });
}

async function loadEmployeeDataLegacy(payload) {
  const openId = await requireOpenId(payload);
  const employeeContext = await getEmployeeContext(openId);

  const [
    courses,
    phrases,
    exams,
    questions,
    rewards,
    employees,
    stores,
    popSubmissions,
    phraseSubmissions,
    cases,
    goldenBeanLedger,
    redemptions,
    examAttempts,
    courseProgress,
    phrasePracticeAttempts,
    taskRewards,
    productRewardRules
  ] = await Promise.all([
    getCollection("courses"),
    getCollection("phrases"),
    getCollection("exams"),
    getCollection("questions", 1000),
    getCollection("rewards"),
    getCollection("employees"),
    getCollection("stores"),
    getCollection("popSubmissions"),
    getCollection("phraseSubmissions"),
    getCollection("cases"),
    getCollection("goldenBeanLedger"),
    getCollection("redemptions"),
    getCollection("examAttempts", 1000).catch(() => []),
    getCollection("courseProgress", 1000).catch(() => []),
    getCollection("phrasePracticeAttempts", 1000).catch(() => []),
    getTaskRewards(),
    getProductRewardRules()
  ]);

  const employeeId = employeeContext?.employee.id;
  const myCourseProgress = employeeId
    ? courseProgress.filter((item) => item.employeeId === employeeId)
    : [];
  const courseProgressById = myCourseProgress.reduce((next, item) => ({
    ...next,
    [item.courseId]: item
  }), {});
  const submissions = employeeId
    ? await Promise.all([...popSubmissions, ...phraseSubmissions, ...cases]
        .map(async (item) => ({
          ...item,
          status: item.status || "pending",
          goldenBeans: Number(item.goldenBeans || 0),
          imageUrl: item.imageUrl || (item.fileId ? await getTempFileURL(item.fileId) : "")
        }))
        .filter((item) => item.employeeId === employeeId))
    : [];

  const myLedger = goldenBeanLedger.filter((item) => item.employeeId === employeeId);
  const phraseLedger = myLedger.filter((item) => item.sourceType === "phrase" && Number(item.delta || 0) > 0);
  const myPhrasePracticeAttempts = phrasePracticeAttempts.filter((item) => item.employeeId === employeeId);
  const myRedemptions = redemptions.filter((item) => item.employeeId === employeeId);
  const myAttempts = examAttempts.filter((item) => item.employeeId === employeeId);
  const examAwardedSet = new Set(
    myLedger
      .filter((item) => item.sourceType === "exam" && Number(item.delta || 0) > 0)
      .map((item) => item.sourceId)
  );
  const ranking = (await Promise.all(employees
    .filter((employee) => employee.status === "active")
    .map(async (employee) => {
      const store = stores.find((item) => item.id === employee.storeId);
      return {
        ...(await publicEmployeeWithAvatar(employee)),
        store: store?.name || ""
      };
    })))
    .sort((a, b) => Number(b.goldenBeans || 0) - Number(a.goldenBeans || 0));

  const publishedExams = exams
    .filter((item) => item.status === "published")
    .map((exam) => {
      const examQuestions = questions
        .filter((question) => question.examId === exam.id)
        .sort((a, b) => Number(a.sortOrder || 999) - Number(b.sortOrder || 999))
        .map(publicQuestion);

      return {
        ...exam,
        questionCount: examQuestions.length || exam.questionIds?.length || 0,
        questions: examQuestions,
        attemptCount: myAttempts.filter((attempt) => attempt.examId === exam.id).length,
        bestScore: myAttempts
          .filter((attempt) => attempt.examId === exam.id)
          .reduce((best, attempt) => Math.max(best, Number(attempt.score || 0)), 0),
        completed: myAttempts.some((attempt) => attempt.examId === exam.id),
        passed: myAttempts.some((attempt) => attempt.examId === exam.id && attempt.passed),
        awarded: examAwardedSet.has(exam.id)
      };
    });
  const rawPublishedCourses = courses.filter((item) => item.status === "published");
  const publishedCourseIds = new Set(rawPublishedCourses.map((course) => course.id));
  const completedCourseCount = myCourseProgress
    .filter((item) => item.completed && publishedCourseIds.has(item.courseId))
    .length;
  const courseCompletionRate = rawPublishedCourses.length > 0
    ? Math.round((completedCourseCount / rawPublishedCourses.length) * 100)
    : 0;
  const publishedCourses = await Promise.all(rawPublishedCourses
    .map((course) => {
      const progress = courseProgressById[course.id];
      return {
        ...course,
        progress: Number(progress?.progress || 0),
        completed: Boolean(progress?.completed)
      };
    })
    .map(publicCourseWithAssets));
  const activeRewards = await Promise.all(rewards
    .filter((item) => item.status === "active")
    .map(publicRewardWithAssets));
  const employee = employeeContext?.employee
    ? {
        ...employeeContext.employee,
        courseCompletionRate: String(courseCompletionRate),
        todayProgress: String(courseCompletionRate)
      }
    : null;

  return ok({
    bound: Boolean(employeeContext),
    employee,
    stores: stores.map((store) => ({
      id: store.id,
      name: store.name,
      regionId: store.regionId || ""
    })),
    courses: publishedCourses,
    phrases: phrases
      .filter((item) => item.status === "published")
      .map((phrase) => {
        const maxRewardedAttempts = phraseAttemptLimit(phrase);
        const recordedCount = myPhrasePracticeAttempts.filter((attempt) => (
          attempt.phraseId === phrase.id && attempt.passed !== false
        )).length;
        const legacyCount = phraseLedger.filter((entry) => (
          entry.sourceId === phrase.id || String(entry.sourceId || "").startsWith(`${phrase.id}-`)
        )).length;

        return {
          ...phrase,
          productName: phrase.productName || phrase.productId || "产品话术",
          maxRewardedAttempts,
          completedCount: Math.min(maxRewardedAttempts, Math.max(recordedCount, legacyCount))
        };
      }),
    exams: publishedExams,
    rewards: activeRewards,
    submissions,
    ranking,
    goldenBeanLedger: myLedger,
    redemptions: myRedemptions,
    examAttempts: myAttempts,
    taskRewards,
    productRewardRules
  });
}

async function loadCoursePlayerData(payload) {
  const openId = await requireOpenId(payload);
  const user = await requireBoundUser(openId);
  const courseId = requireString(payload.courseId, "courseId");
  const [course, progress, employee] = await Promise.all([
    getFirst("courses", { _id: courseId, status: "published" }),
    getFirst("courseProgress", { employeeId: user.employeeId, courseId }).catch(() => null),
    getFirst("employees", { _id: user.employeeId, status: "active" })
  ]);

  if (!course) {
    return fail("课程不存在或未发布", "COURSE_NOT_FOUND");
  }

  const publicCourse = await publicCourseWithAssets(normalizeId(course));
  return ok({
    course: {
      ...publicCourse,
      progress: Number(progress?.progress || 0),
      completed: Boolean(progress?.completed),
      hasVideo: Boolean(publicCourse.videoUrl)
    },
    goldenBeans: Number(employee?.goldenBeans || 0)
  });
}

async function bindEmployee(payload) {
  const openId = await requireOpenId(payload);
  const existingUser = await getFirst("users", { openId });

  // A WeChat identity is a single account. Re-login must never create or
  // switch to another store; profile changes go through updateEmployeeProfile.
  if (existingUser) {
    const existingEmployee = await getFirst("employees", {
      _id: existingUser.employeeId,
      status: "active"
    });
    if (!existingEmployee) {
      return fail("当前微信账号的员工资料不存在，请联系管理员", "EMPLOYEE_ACCOUNT_INVALID");
    }

    if (existingUser.status !== "active") {
      await db.collection("users").doc(existingUser._id).update({
        status: "active",
        role: existingEmployee.role || "employee",
        updatedAt: now()
      });
    }

    const existingStore = existingEmployee.storeId
      ? await getFirst("stores", { _id: existingEmployee.storeId })
      : null;
    return ok({
      employee: {
        ...(await publicEmployeeWithAvatar(existingEmployee)),
        id: existingEmployee._id,
        store: existingStore?.name || ""
      },
      existingAccount: true
    });
  }

  const employeeName = requireString(payload.employeeName, "employeeName");
  await assertTextSafe({
    content: employeeName,
    openId,
    scene: 1,
    appId: wxAppId,
    appSecret: wxAppSecret
  });

  const storeResult = payload.storeId ? await findStoreById(payload.storeId) : await findStore(payload.storeName);
  if (storeResult.error) {
    return storeResult.error;
  }

  const storeId = storeResult.store._id || storeResult.store.id;
  const employeeResult = await findOrCreateEmployeeByStoreAndName(storeResult.store, employeeName);
  const employee = employeeResult.employee;
  await db.collection("users").add({
    openId,
    employeeId: employee._id,
    role: employee.role || "employee",
    status: "active",
    createdAt: now(),
    updatedAt: now()
  });

  return ok({
    employee: {
      ...(await publicEmployeeWithAvatar(employee)),
      id: employee._id,
      store: storeResult.store.name
    }
  });
}

async function logoutEmployee(payload) {
  const openId = await requireOpenId(payload);
  const existingUser = await getFirst("users", { openId, status: "active" });

  if (existingUser) {
    await db.collection("users").doc(existingUser._id).update({
      status: "inactive",
      updatedAt: now()
    });
  }

  return ok({ bound: false });
}

async function getEmployeeGoldenBeanBalance(employeeId) {
  const employee = await getFirst("employees", { _id: employeeId });
  return Number(employee?.goldenBeans || 0);
}

async function completeCourse(payload) {
  const openId = await requireOpenId(payload);
  const user = await requireBoundUser(openId);
  const courseId = requireString(payload.courseId, "courseId");
  const course = await getFirst("courses", { _id: courseId, status: "published" });

  if (!course) {
    return fail("课程不存在或未发布", "COURSE_NOT_FOUND");
  }

  const hasVideo = Boolean(optionalString(course.videoUrl || course.videoFileId));
  if (!hasVideo) {
    return fail("该课程暂未上传视频，完成视频学习后才能获得金豆", "COURSE_VIDEO_REQUIRED");
  }
  if (payload.watchCompleted !== true) {
    return fail("请先播放完视频再领取金豆", "COURSE_VIDEO_NOT_FINISHED");
  }

  const existingProgress = await getFirst("courseProgress", {
    employeeId: user.employeeId,
    courseId
  });

  if (existingProgress) {
    await db.collection("courseProgress").doc(existingProgress._id).update({
      progress: 100,
      completed: true,
      updatedAt: now()
    });
  } else {
    await db.collection("courseProgress").add({
      employeeId: user.employeeId,
      courseId,
      progress: 100,
      completed: true,
      createdAt: now(),
      updatedAt: now()
    });
  }

  const productKey = productKeyOf(course);
  const award = await addCappedGoldenBeans({
    employeeId: user.employeeId,
    sourceType: "course",
    sourceId: courseId,
    productKey,
    delta: Number(course.goldenBeans || 0),
    reason: `完成课程：${course.title}`,
    createdBy: "mini-program",
    productCap: await getProductRewardCap(productKey)
  });
  const goldenBeans = await getEmployeeGoldenBeanBalance(user.employeeId);

  return ok({ courseId, award, goldenBeans });
}

async function submitExam(payload) {
  const openId = await requireOpenId(payload);
  const user = await requireBoundUser(openId);
  const examId = requireString(payload.examId, "examId");
  const answers = Array.isArray(payload.answers) ? payload.answers : [];
  const exam = await getFirst("exams", { _id: examId, status: "published" });

  if (!exam) {
    return fail("考试不存在或未发布", "EXAM_NOT_FOUND");
  }

  const questionResult = await db.collection("questions").where({ examId }).get();
  const questions = questionResult.data || [];

  const answerByQuestionId = {};
  answers.forEach((answer, index) => {
    const questionId = answer?.questionId || questions[index]?._id;
    if (questionId) {
      answerByQuestionId[questionId] = normalizeSubmittedAnswer(answer);
    }
  });

  const correctCount = questions.reduce((count, question) => {
    const questionId = question._id || question.id;
    const submitted = answerByQuestionId[questionId] || [];
    return count + (sameIndexes(submitted, normalizeQuestionAnswerIndexes(question)) ? 1 : 0);
  }, 0);
  const score = questions.length === 0 ? 0 : Math.round((correctCount / questions.length) * 100);
  const passed = score >= Number(exam.passScore || 0);

  const attempt = {
    employeeId: user.employeeId,
    examId,
    answers,
    score,
    passed,
    correctCount,
    questionCount: questions.length,
    createdAt: now()
  };
  const attemptResult = await db.collection("examAttempts").add(attempt);

  const productKey = productKeyOf(exam);
  const award = passed
    ? await addCappedGoldenBeans({
        employeeId: user.employeeId,
        sourceType: "exam",
        sourceId: examId,
        productKey,
        delta: Number(exam.goldenBeans || 0),
        reason: `通过考试：${exam.title}`,
        createdBy: "mini-program",
        productCap: await getProductRewardCap(productKey)
      })
    : null;
  const goldenBeans = await getEmployeeGoldenBeanBalance(user.employeeId);

  return ok({
    attemptId: attemptResult.id,
    score,
    passed,
    correctCount,
    questionCount: questions.length,
    award,
    goldenBeans
  });
}

async function recognizePhrase(payload) {
  const openId = await requireOpenId(payload);
  const user = await requireBoundUser(openId);
  const phraseId = requireString(payload.phraseId, "phraseId");
  const fileId = requireString(payload.fileId, "fileId");
  const phrase = await getFirst("phrases", { _id: phraseId, status: "published" });

  if (!phrase) {
    return fail("话术不存在或未发布", "PHRASE_NOT_FOUND");
  }

  const productKey = productKeyOf(phrase);
  const maxRewardedAttempts = phraseAttemptLimit(phrase);
  const [practiceResult, completionLedger] = await Promise.all([
    db.collection("phrasePracticeAttempts").where({
      employeeId: user.employeeId,
      phraseId
    }).limit(100).get().catch(() => ({ data: [] })),
    db.collection("goldenBeanLedger").where({
      employeeId: user.employeeId,
      sourceType: "phrase"
    }).limit(1000).get()
  ]);
  const recordedCount = (practiceResult.data || []).filter((attempt) => attempt.passed !== false).length;
  const legacyCount = (completionLedger.data || []).filter((entry) => (
    Number(entry.delta || 0) > 0
      && (entry.sourceId === phraseId || String(entry.sourceId || "").startsWith(`${phraseId}-`))
  )).length;
  const completedCount = Math.min(maxRewardedAttempts, Math.max(recordedCount, legacyCount));
  const existingAttempt = await getFirst("phrasePracticeAttempts", {
    employeeId: user.employeeId,
    phraseId,
    fileId
  }).catch(() => null);
  if (existingAttempt) {
    const goldenBeans = await getEmployeeGoldenBeanBalance(user.employeeId);
    return ok({
      passed: true,
      text: existingAttempt.recognizedText || "",
      score: Number(existingAttempt.score || 0),
      completedCount,
      award: { awarded: false, delta: 0, duplicate: true },
      goldenBeans
    });
  }

  const tempUrl = await getTempFileURL(fileId);
  if (!tempUrl) {
    return fail("录音文件暂时无法读取，请重新录音", "PHRASE_AUDIO_NOT_FOUND");
  }

  const audioResponse = await fetch(tempUrl);
  if (!audioResponse.ok) {
    return fail("录音文件下载失败，请重新录音", "PHRASE_AUDIO_DOWNLOAD_FAILED");
  }
  const audio = Buffer.from(await audioResponse.arrayBuffer());
  if (audio.length === 0) {
    return fail("录音为空，请重新录音", "PHRASE_AUDIO_EMPTY");
  }

  const recognition = await recognizeAudio({ audio, voiceFormat: "mp3" });
  const comparison = compareSpeechText(phrase.script, recognition.text);
  console.log("[speech-recognition]", {
    phraseId,
    productKey,
    requestId: recognition.requestId,
    recognizedLength: recognition.text.length,
    expectedLength: phrase.script.length,
    score: comparison.score,
    matched: comparison.matched
  });
  if (!comparison.matched) {
    return ok({
      passed: false,
      text: recognition.text,
      score: comparison.score,
      completedCount
    });
  }

  const shouldCountCompletion = completedCount < maxRewardedAttempts;
  let nextCompletedCount = completedCount;
  let award = { awarded: false, delta: 0, practiceOnly: true };
  if (shouldCountCompletion) {
    nextCompletedCount += 1;
    award = await addCappedGoldenBeans({
        employeeId: user.employeeId,
        sourceType: "phrase",
        sourceId: `${phraseId}-${nextCompletedCount}`,
        productKey,
        delta: Number(phrase.goldenBeans || 0),
        reason: `金句开口说：${phrase.title}（第 ${nextCompletedCount} 遍）`,
        createdBy: "mini-program",
        productCap: await getProductRewardCap(productKey)
      });
    try {
      await db.collection("phrasePracticeAttempts").add({
        employeeId: user.employeeId,
        phraseId,
        productKey,
        fileId,
        passed: true,
        score: comparison.score,
        recognizedText: recognition.text,
        createdAt: now()
      });
    } catch (error) {
      if (!award.ledger) {
        throw error;
      }
      console.error("[phrase-practice-attempt] ledger preserved completion", error.message);
    }
  }
  const goldenBeans = await getEmployeeGoldenBeanBalance(user.employeeId);

  return ok({
    passed: true,
    text: recognition.text,
    score: comparison.score,
    completedCount: nextCompletedCount,
    maxRewardedAttempts,
    award,
    goldenBeans
  });
}

async function submitContent(payload) {
  const openId = await requireOpenId(payload);
  const user = await requireBoundUser(openId);
  const type = requireString(payload.type, "type");
  const title = requireString(payload.title, "title");
  const collectionName = collectionByType[type];

  if (!collectionName) {
    return fail("不支持的提交类型", "INVALID_CONTENT_TYPE");
  }

  const employee = await getFirst("employees", { _id: user.employeeId, status: "active" });
  if (!employee) {
    return fail("没有找到这个员工", "EMPLOYEE_NOT_FOUND");
  }

  const taskRewards = await getTaskRewards();
  const submission = {
    type,
    title,
    employeeId: employee._id,
    storeId: employee.storeId,
    regionId: employee.regionId,
    status: "pending",
    goldenBeans: nonNegativeInteger(taskRewards[type], defaultGoldenBeans[type] ?? 0),
    fileId: optionalString(payload.fileId),
    imageUrl: optionalString(payload.imageUrl),
    content: optionalString(payload.content),
    images: type === "case" ? normalizeCaseImages({
      images: Array.isArray(payload.images) && payload.images.length > 0
        ? payload.images
        : [{ fileId: payload.fileId, imageUrl: payload.imageUrl }]
    }) : [],
    phraseId: optionalString(payload.phraseId),
    createdAt: now()
  };

  if (type === "phrase" && !submission.phraseId) {
    return fail("缺少开口说任务", "PHRASE_ID_REQUIRED");
  }
  if (type === "pop" && !submission.fileId) {
    return fail("缺少 POP 文件", "FILE_ID_REQUIRED");
  }
  if (type === "case" && !submission.content) {
    return fail("缺少案例内容", "CONTENT_REQUIRED");
  }
  await assertTextSafe({
    content: [submission.title, submission.content].filter(Boolean).join("\n"),
    openId,
    scene: type === "case" ? 4 : 1,
    appId: wxAppId,
    appSecret: wxAppSecret
  });

  const result = await db.collection(collectionName).add(submission);

  return ok({
    submissionId: result.id,
    submission: {
      id: result.id,
      ...submission
    }
  });
}

async function uploadFile(payload) {
  const openId = await requireOpenId(payload);
  const user = await requireBoundUser(openId);
  const file = payload.file;

  if (!file?.content || !Buffer.isBuffer(file.content) || file.content.length === 0) {
    return fail("请选择要上传的文件", "FILE_REQUIRED");
  }
  const folder = safeFolderName(payload.folder);
  if (requiresImageSecurityCheck(file, folder)) {
    await assertImageSafe({
      file,
      appId: wxAppId,
      appSecret: wxAppSecret
    });
  }

  const extension = extensionFromFile(file);
  const cloudPath = `${folder}/${user.employeeId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.${extension}`;
  const uploadResult = await app.uploadFile({
    cloudPath,
    fileContent: file.content
  });
  const tempFileURL = await getTempFileURL(uploadResult.fileID);

  return ok({
    fileID: uploadResult.fileID,
    tempFileURL,
    cloudPath,
    size: file.content.length,
    contentType: file.contentType
  });
}

async function updateEmployeeProfile(payload) {
  const openId = await requireOpenId(payload);
  const user = await requireBoundUser(openId);
  const rawAvatarFileId = optionalString(payload.avatarFileId);
  const rawAvatarUrl = optionalString(payload.avatarUrl);
  const avatarChangeRequested = payload.avatarFileId !== undefined || payload.avatarUrl !== undefined;
  const avatarFileId = rawAvatarFileId || (isCloudFileId(rawAvatarUrl) ? rawAvatarUrl : "");
  const expectedAvatarPath = `/employee-avatars/${user.employeeId}/`;
  if (avatarChangeRequested && (!isCloudFileId(avatarFileId) || !avatarFileId.includes(expectedAvatarPath))) {
    return fail("请重新选择头像并完成安全校验", "AVATAR_SECURITY_CHECK_REQUIRED");
  }
  const avatarUrl = avatarFileId ? await getTempFileURL(avatarFileId) : rawAvatarUrl;
  const profileUpdate = {};

  if (payload.employeeName !== undefined) {
    profileUpdate.name = requireString(payload.employeeName, "employeeName");
    await assertTextSafe({
      content: profileUpdate.name,
      openId,
      scene: 1,
      appId: wxAppId,
      appSecret: wxAppSecret
    });
  }

  if (payload.storeId || payload.storeName) {
    const storeResult = payload.storeId
      ? await findStoreById(payload.storeId)
      : await findStore(payload.storeName);
    if (storeResult.error) {
      return storeResult.error;
    }
    profileUpdate.storeId = storeResult.store._id || storeResult.store.id;
    profileUpdate.regionId = storeResult.store.regionId || "";
  }

  if (!avatarFileId && !avatarUrl && Object.keys(profileUpdate).length === 0) {
    return fail("请填写要修改的资料", "PROFILE_UPDATE_REQUIRED");
  }

  await db.collection("employees").doc(user.employeeId).update({
    ...profileUpdate,
    ...(avatarFileId || avatarUrl
      ? {
          avatarFileId,
          avatarUrl: isHttpUrl(avatarUrl) ? avatarUrl : ""
        }
      : {}),
    updatedAt: now()
  });

  const employee = await getFirst("employees", { _id: user.employeeId, status: "active" });
  const store = employee?.storeId ? await getFirst("stores", { _id: employee.storeId }) : null;

  return ok({
    employee: employee
      ? {
          ...(await publicEmployeeWithAvatar(normalizeId(employee))),
          store: store?.name || ""
        }
      : null
  });
}

async function redeemReward(payload) {
  const openId = await requireOpenId(payload);
  const user = await requireBoundUser(openId);
  const rewardId = requireString(payload.rewardId, "rewardId");
  const employee = await getFirst("employees", { _id: user.employeeId, status: "active" });
  const reward = await getFirst("rewards", { _id: rewardId, status: "active" });

  if (!employee || !reward) {
    return fail("员工或奖励不存在", "NOT_FOUND");
  }

  const cost = Number(reward.goldenBeanPrice || 0);
  if (Number(employee.goldenBeans || 0) < cost) {
    return fail("金豆不足", "INSUFFICIENT_GOLDEN_BEANS");
  }
  if (Number(reward.stock || 0) <= 0) {
    return fail("库存不足", "OUT_OF_STOCK");
  }

  await db.collection("employees").doc(employee._id).update({
    goldenBeans: command.inc(-cost)
  });
  await db.collection("rewards").doc(reward._id).update({
    stock: command.inc(-1)
  });
  await db.collection("goldenBeanLedger").add({
    employeeId: employee._id,
    sourceType: "redemption",
    sourceId: reward._id,
    delta: -cost,
    reason: `兑换奖励：${reward.title}`,
    createdBy: "mini-program",
    createdAt: now()
  });
  const redemptionResult = await db.collection("redemptions").add({
    employeeId: employee._id,
    rewardId: reward._id,
    goldenBeanCost: cost,
    status: "pending",
    createdAt: now()
  });

  return ok({
    redemptionId: redemptionResult.id,
    goldenBeanCost: cost
  });
}

async function handleAction(payload) {
  switch (payload.action) {
    case "employeeData":
      return loadEmployeeData(payload);
    case "employeeDataBatch":
      return loadEmployeeDataBatch(payload);
    case "coursePlayerData":
      return loadCoursePlayerData(payload);
    case "caseFeed":
      return loadCaseFeed(payload);
    case "createCasePost":
      return createCasePost(payload);
    case "toggleCaseLike":
      return toggleCaseLike(payload);
    case "addCaseComment":
      return addCaseComment(payload);
    case "deleteCasePost":
      return deleteCasePost(payload);
    case "deleteCaseComment":
      return deleteCaseComment(payload);
    case "bindEmployee":
      return bindEmployee(payload);
    case "logoutEmployee":
      return logoutEmployee(payload);
    case "completeCourse":
      return completeCourse(payload);
    case "recognizePhrase":
      return recognizePhrase(payload);
    case "submitExam":
      return submitExam(payload);
    case "submitContent":
      return submitContent(payload);
    case "uploadFile":
      return uploadFile(payload);
    case "updateEmployeeProfile":
      return updateEmployeeProfile(payload);
    case "redeemReward":
      return redeemReward(payload);
    default:
      return fail("不支持的操作", "INVALID_ACTION");
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, {}, 204);
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, fail("Only POST requests are supported", "METHOD_NOT_ALLOWED"), 405);
    return;
  }

  let payload = {};
  try {
    payload = await readPayload(req);
    const result = await handleAction(payload);
    sendJson(res, result, result.ok ? 200 : 400);
  } catch (error) {
    console.error("[miniProgramApi-error]", {
      action: payload?.action || "unknown",
      code: error.code || "MINIPROGRAM_API_FAILED",
      message: error.message
    });
    sendJson(res, fail(error.message, error.code || "MINIPROGRAM_API_FAILED"), 500);
  }
});

server.listen(9000, "0.0.0.0", () => {
  console.log("miniProgramApi HTTP function listening on port 9000");
});
