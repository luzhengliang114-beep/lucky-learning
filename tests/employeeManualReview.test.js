const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MANUAL_REVIEW_MODE,
  WECHAT_OAUTH_MODE,
  createManualIdentity,
  isManualIdentity,
  normalizeEmployeeLoginMode,
  shouldRunWechatContentSecurity
} = require("../cloudbase/functions/employeeWeb/manualReviewCore");

test("normalizes explicit manual review mode and defaults to OAuth", () => {
  assert.equal(normalizeEmployeeLoginMode("manual-review"), MANUAL_REVIEW_MODE);
  assert.equal(normalizeEmployeeLoginMode("wechat-oauth"), WECHAT_OAUTH_MODE);
  assert.equal(normalizeEmployeeLoginMode("unknown"), WECHAT_OAUTH_MODE);
});

test("creates an opaque manual identity", () => {
  const identity = createManualIdentity(() => Buffer.alloc(24, 7));
  assert.equal(isManualIdentity(identity), true);
  assert.equal(identity.startsWith("manual:"), true);
  assert.equal(identity.includes("员工"), false);
});

test("manual identities do not call WeChat content security", () => {
  assert.equal(shouldRunWechatContentSecurity({ openId: "manual:opaque", appId: "appid", appSecret: "secret" }), false);
  assert.equal(shouldRunWechatContentSecurity({ openId: "openid", appId: "appid", appSecret: "secret" }), true);
  assert.equal(shouldRunWechatContentSecurity({ openId: "openid", appId: "", appSecret: "" }), false);
});
