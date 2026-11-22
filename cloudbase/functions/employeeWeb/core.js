const allowedMediaTypes = new Map([
  ["image/jpeg", { folder: "employee-web/cases/images", extension: "jpg" }],
  ["image/png", { folder: "employee-web/cases/images", extension: "png" }],
  ["image/gif", { folder: "employee-web/cases/images", extension: "gif" }],
  ["image/webp", { folder: "employee-web/cases/images", extension: "webp" }],
  ["audio/mpeg", { folder: "employee-web/recordings", extension: "mp3" }],
  ["audio/mp4", { folder: "employee-web/recordings", extension: "m4a" }],
  ["audio/wav", { folder: "employee-web/recordings", extension: "wav" }],
  ["audio/webm", { folder: "employee-web/recordings", extension: "webm" }],
  ["video/mp4", { folder: "employee-web/cases/videos", extension: "mp4" }],
  ["video/quicktime", { folder: "employee-web/cases/videos", extension: "mov" }],
  ["video/webm", { folder: "employee-web/cases/videos", extension: "webm" }]
]);

const MAX_EXAM_ATTEMPTS = 2;

function examAttemptsRemaining(attemptCount) {
  return Math.max(0, MAX_EXAM_ATTEMPTS - Math.max(0, Math.trunc(Number(attemptCount) || 0)));
}

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function optionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function originFromUrl(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function corsOriginForRequest(requestOrigin, configuredOrigins = "", redirectUri = "") {
  const origin = optionalString(requestOrigin);
  if (!origin) return "";
  const allowed = new Set(String(configuredOrigins || "").split(",").map((value) => originFromUrl(value.trim()) || value.trim()).filter(Boolean));
  const redirectOrigin = originFromUrl(redirectUri);
  if (redirectOrigin) allowed.add(redirectOrigin);
  return allowed.has(origin) ? origin : "";
}

function parseMediaDataUrl(value) {
  const match = optionalString(value).match(/^data:([^;,]+)(?:;[^;,]+)*;base64,([a-z0-9+/=\s]+)$/i);
  if (!match) throw codedError("上传文件格式不正确", "FILE_FORMAT_INVALID");
  const contentType = match[1].toLowerCase();
  const storage = allowedMediaTypes.get(contentType);
  if (!storage) throw codedError("仅支持常见图片、音频或视频格式", "FILE_TYPE_INVALID");
  const encoded = match[2].replace(/\s/g, "");
  if (!encoded || encoded.length % 4 === 1) throw codedError("上传文件格式不正确", "FILE_FORMAT_INVALID");
  const content = Buffer.from(encoded, "base64");
  if (!content.length) throw codedError("请选择要上传的文件", "FILE_REQUIRED");
  return { contentType, content, ...storage };
}

function isPrivateReceiptUploadFolder(folder) {
  return optionalString(folder) === "employee-web/store-receipts";
}

function voiceFormatForContentType(value) {
  const contentType = optionalString(value).toLowerCase().split(";")[0];
  const formats = {
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav"
  };
  const format = formats[contentType];
  if (!format) throw codedError("当前录音格式暂不支持，请重新录音", "PHRASE_AUDIO_FORMAT_UNSUPPORTED");
  return format;
}

function wavDurationSeconds(value) {
  const audio = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") return 0;
  let byteRate = 0;
  let dataSize = 0;
  let offset = 12;
  while (offset + 8 <= audio.length) {
    const chunkId = audio.toString("ascii", offset, offset + 4);
    const chunkSize = audio.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkStart + chunkSize > audio.length) return 0;
    if (chunkId === "fmt " && chunkSize >= 16) byteRate = audio.readUInt32LE(chunkStart + 8);
    if (chunkId === "data") {
      dataSize = chunkSize;
      break;
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }
  return byteRate > 0 && dataSize > 0 ? dataSize / byteRate : 0;
}

function isCloudFileId(value) {
  const raw = optionalString(value);
  return raw.startsWith("cloud://") || raw.startsWith("cloudbase://");
}

function chunkCloudFileIds(fileIds = [], batchSize = 50) {
  const size = Math.max(1, Math.trunc(Number(batchSize) || 50));
  const uniqueIds = [...new Set(fileIds.filter(isCloudFileId))];
  const batches = [];
  for (let index = 0; index < uniqueIds.length; index += size) {
    batches.push(uniqueIds.slice(index, index + size));
  }
  return batches;
}

function normalizeCaseMedia(payload = {}) {
  const videoFileId = optionalString(payload.videoFileId);
  const rawImages = Array.isArray(payload.images) ? payload.images : [];
  if (rawImages.length > 9) throw codedError("一条案例最多上传 9 张图片", "TOO_MANY_IMAGES");
  if (videoFileId && rawImages.length) throw codedError("一条案例不能同时上传图片和视频", "MIXED_CASE_MEDIA");
  if (videoFileId && !isCloudFileId(videoFileId)) throw codedError("案例视频地址无效", "INVALID_VIDEO_FILE");
  const images = rawImages.map((image) => {
    const fileId = optionalString(image?.fileId || image?.fileID);
    if (!isCloudFileId(fileId)) throw codedError("案例图片地址无效", "INVALID_IMAGE_FILE");
    return {
      fileId,
      width: Math.max(0, Number(image?.width || 0)),
      height: Math.max(0, Number(image?.height || 0)),
      size: Math.max(0, Number(image?.size || 0))
    };
  });
  return { images, videoFileId };
}

function configuredSubmissionReward(taskRewards = {}, type, defaults = {}) {
  const fallback = Math.max(0, Math.trunc(Number(defaults[type] || 0)));
  const configured = Number(taskRewards[type]);
  return Number.isFinite(configured) && configured >= 0 ? Math.trunc(configured) : fallback;
}

function learningCompletionRate({ courses = [], phrases = [], exams = [] } = {}) {
  const courseValues = courses.map((course) => course?.completed === true ? 100 : Number(course?.progress || 0));
  const phraseValues = [];
  for (const phrase of phrases) {
    const limit = Math.max(1, Math.trunc(Number(phrase?.maxRewardedAttempts || 1)));
    const completed = Math.min(limit, Math.max(0, Math.trunc(Number(phrase?.completedCount || 0))));
    for (let index = 0; index < limit; index += 1) phraseValues.push(index < completed ? 100 : 0);
  }
  const examValues = exams.map((exam) => exam?.completed === true ? 100 : 0);
  const values = [...courseValues, ...phraseValues, ...examValues];
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + Math.max(0, Math.min(100, Number(value) || 0)), 0) / values.length);
}

function visibleCasePosts(cases = [], _storeId = "") {
  return cases
    // Approved cases are company learning material. They must be visible to
    // every active employee, regardless of the publishing employee's store.
    .filter((item) => !item?.deletedAt && item?.status !== "deleted" && ["approved", "published"].includes(item?.status))
    .sort((left, right) => String(right?.createdAt || "").localeCompare(String(left?.createdAt || "")));
}

function phraseCompletionCount({ attempts = [], ledger = [], phraseId, maxRewardedAttempts = 1 }) {
  const limit = Math.max(1, Math.trunc(Number(maxRewardedAttempts || 1)));
  const recordedCount = attempts.filter((attempt) => attempt.phraseId === phraseId && attempt.passed !== false && attempt.counted !== false).length;
  const legacyCount = ledger.filter((entry) => Number(entry.delta || 0) > 0 && (entry.sourceId === phraseId || String(entry.sourceId || "").startsWith(`${phraseId}-`))).length;
  return Math.min(limit, Math.max(recordedCount, legacyCount));
}

module.exports = {
  MAX_EXAM_ATTEMPTS,
  chunkCloudFileIds,
  configuredSubmissionReward,
  corsOriginForRequest,
  examAttemptsRemaining,
  isPrivateReceiptUploadFolder,
  learningCompletionRate,
  normalizeCaseMedia,
  parseMediaDataUrl,
  phraseCompletionCount,
  visibleCasePosts,
  voiceFormatForContentType,
  wavDurationSeconds
};
