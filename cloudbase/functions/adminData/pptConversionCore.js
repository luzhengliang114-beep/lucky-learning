const { randomBytes } = require("node:crypto");

function optionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseCloudFileId(fileId) {
  const raw = optionalString(fileId);
  const match = /^cloud(?:base)?:\/\/([^/]+)\/(.+)$/i.exec(raw);
  if (!match) {
    const error = new Error("PPT 文件不是当前云存储文件，请重新上传");
    error.code = "PPT_CLOUD_FILE_REQUIRED";
    throw error;
  }
  return {
    authority: match[1],
    key: decodeURIComponent(match[2]).replace(/^\/+/, "")
  };
}

function parseCosLocation(tempUrl, fallback = {}) {
  const url = new URL(tempUrl);
  const standardHost = /^(.+)\.cos(?:-internal)?\.([a-z0-9-]+)\.myqcloud\.com$/i.exec(url.hostname);
  const bucket = optionalString(fallback.bucket) || optionalString(standardHost?.[1]);
  const region = optionalString(fallback.region) || optionalString(standardHost?.[2]);
  if (!bucket || !region) {
    const error = new Error("无法识别 PPT 所在的云存储桶，请配置 PPT_COS_BUCKET 和 PPT_COS_REGION");
    error.code = "PPT_COS_LOCATION_REQUIRED";
    throw error;
  }
  return { bucket, region };
}

function buildOutputPrefix(sourceKey, timestamp = Date.now(), suffix = randomBytes(4).toString("hex")) {
  const filename = sourceKey.split("/").pop() || "slides";
  const base = filename.replace(/\.[^.]+$/, "").replace(/[^0-9a-zA-Z_-]/g, "-").slice(0, 48) || "slides";
  return `admin-courses/ppt-slides/${base}-${timestamp}-${suffix}/page-`;
}

function buildCloudFileId(authority, key) {
  return `cloud://${optionalString(authority)}/${optionalString(key).replace(/^\/+/, "")}`;
}

function normalizedJobState(rawState) {
  const state = optionalString(rawState).toLowerCase();
  if (["success", "succeeded", "complete", "completed"].includes(state)) return "ready";
  if (["failed", "fail", "error", "cancelled", "canceled"].includes(state)) return "failed";
  return "processing";
}

function pageNumberFromKey(key) {
  const match = /(?:page[-_]?|\/)(\d+)\.(?:jpe?g|png|webp)$/i.exec(optionalString(key));
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function sortedSlideKeys(contents, outputPrefix) {
  const prefix = optionalString(outputPrefix);
  return (Array.isArray(contents) ? contents : [])
    .map((item) => optionalString(item?.Key || item?.key || item))
    .filter((key) => key.startsWith(prefix) && /\.(?:jpe?g|png|webp)$/i.test(key))
    .sort((left, right) => pageNumberFromKey(left) - pageNumberFromKey(right) || left.localeCompare(right));
}

function nestedValue(object, keys) {
  let current = object;
  for (const key of keys) current = current?.[key];
  return current;
}

function firstNestedValue(object, paths) {
  for (const path of paths) {
    const value = nestedValue(object, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function xmlValue(xml, tag) {
  const match = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, "i").exec(optionalString(xml));
  return optionalString(match?.[1]);
}

function parseCreatedJob(response = {}) {
  const jobId = optionalString(firstNestedValue(response, [
    ["JobsDetail", "JobId"],
    ["JobsDetail", "JobID"],
    ["Response", "JobsDetail", "JobId"],
    ["Response", "JobsDetail", "JobID"]
  ])) || xmlValue(response.Body, "JobId") || xmlValue(response.Body, "JobID");
  if (!jobId) {
    const error = new Error("腾讯云未返回 PPT 转码任务编号");
    error.code = "PPT_CONVERSION_JOB_MISSING";
    throw error;
  }
  return jobId;
}

function parseJobResult(response = {}) {
  const detail = firstNestedValue(response, [
    ["JobsDetail"],
    ["Response", "JobsDetail"]
  ]) || {};
  const state = normalizedJobState(detail.State || detail.Status || xmlValue(response.Body, "State") || xmlValue(response.Body, "Status"));
  return {
    state,
    errorCode: optionalString(detail.Code || detail.ErrorCode || xmlValue(response.Body, "Code") || xmlValue(response.Body, "ErrorCode")),
    errorMessage: optionalString(detail.Message || detail.ErrorMessage || xmlValue(response.Body, "Message") || xmlValue(response.Body, "ErrorMessage"))
  };
}

module.exports = {
  buildCloudFileId,
  buildOutputPrefix,
  normalizedJobState,
  parseCloudFileId,
  parseCosLocation,
  parseCreatedJob,
  parseJobResult,
  sortedSlideKeys
};
