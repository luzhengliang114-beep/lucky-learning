const { timingSafeEqual } = require("node:crypto");

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function bearerSecret(value) {
  const match = /^Bearer\s+(.+)$/i.exec(String(value || "").trim());
  return match ? match[1].trim() : "";
}

function assertAdminSecret({ configuredSecret, providedSecret }) {
  const expected = String(configuredSecret || "").trim();
  if (!expected) throw codedError("管理服务尚未配置访问口令", "ADMIN_SECRET_REQUIRED");
  const provided = String(providedSecret || "").trim();
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (expectedBytes.length !== providedBytes.length || !timingSafeEqual(expectedBytes, providedBytes)) {
    throw codedError("管理访问口令无效", "ADMIN_UNAUTHORIZED");
  }
  return true;
}

function originFromUrl(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function corsOriginForRequest(requestOrigin, configuredOrigins = "") {
  const origin = originFromUrl(String(requestOrigin || "").trim());
  if (!origin) return "";
  const allowed = new Set(String(configuredOrigins || "").split(",").map((value) => originFromUrl(value.trim())).filter(Boolean));
  return allowed.has(origin) ? origin : "";
}

module.exports = { assertAdminSecret, bearerSecret, corsOriginForRequest };
