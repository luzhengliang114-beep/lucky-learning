const { randomBytes } = require("node:crypto");

const WECHAT_OAUTH_MODE = "wechat-oauth";
const MANUAL_REVIEW_MODE = "manual-review";

function normalizeEmployeeLoginMode(value) {
  return String(value || "").trim().toLowerCase() === MANUAL_REVIEW_MODE
    ? MANUAL_REVIEW_MODE
    : WECHAT_OAUTH_MODE;
}

function createManualIdentity(randomBytesImpl = randomBytes) {
  return `manual:${randomBytesImpl(24).toString("base64url")}`;
}

function isManualIdentity(value) {
  return String(value || "").startsWith("manual:");
}

function shouldRunWechatContentSecurity({ openId, appId, appSecret } = {}) {
  return !isManualIdentity(openId) && Boolean(String(appId || "").trim() && String(appSecret || "").trim());
}

module.exports = {
  MANUAL_REVIEW_MODE,
  WECHAT_OAUTH_MODE,
  createManualIdentity,
  isManualIdentity,
  normalizeEmployeeLoginMode,
  shouldRunWechatContentSecurity
};
