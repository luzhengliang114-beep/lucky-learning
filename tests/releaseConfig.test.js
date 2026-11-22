const assert = require("node:assert/strict");
const test = require("node:test");

async function core() {
  return import("../scripts/release-config-core.mjs");
}

const completeEnv = {
  EMPLOYEE_LOGIN_MODE: "wechat-oauth",
  VITE_EMPLOYEE_LOGIN_MODE: "wechat-oauth",
  WECHAT_OA_APPID: "appid-value",
  WECHAT_OA_APP_SECRET: "app-secret-value",
  WECHAT_OAUTH_REDIRECT_URI: "https://employee.example.com/employee/",
  WEB_ALLOWED_ORIGINS: "https://employee.example.com",
  WEB_SESSION_SECRET: "session-secret-value-with-sufficient-length",
  EMPLOYEE_IDENTITY_HASH_SECRET: "identity-hash-secret-with-sufficient-length",
  PRIVACY_CONTACT: "0755-12345678",
  ALLOW_DIRECT_LOGIN: "false",
  ADMIN_REVIEW_SECRET: "admin-secret-value-with-sufficient-length",
  ADMIN_ALLOWED_ORIGINS: "https://admin.example.com",
  VITE_EMPLOYEE_API_ENDPOINT: "https://api.example.com/employee",
  VITE_ADMIN_API_ENDPOINT: "https://api.example.com/admin"
};

test("accepts an explicit isolated release configuration", async () => {
  const { validateReleaseConfig } = await core();
  const result = validateReleaseConfig({ env: completeEnv, cloudbaseConfig: { envId: "training-prod-123" } });
  assert.equal(result.ok, true);
  assert.equal(result.targetEnvId, "training-prod-123");
  assert.deepEqual(result.missing, []);
});

test("reports missing names without exposing configured secret values", async () => {
  const { validateReleaseConfig } = await core();
  const result = validateReleaseConfig({
    env: { ...completeEnv, WEB_SESSION_SECRET: "", ADMIN_REVIEW_SECRET: "" },
    cloudbaseConfig: { envId: "" }
  });
  const report = JSON.stringify(result);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["CLOUDBASE_ENV_ID", "WEB_SESSION_SECRET", "ADMIN_REVIEW_SECRET"]);
  assert.equal(report.includes(completeEnv.WECHAT_OA_APP_SECRET), false);
});

test("accepts manual review mode without WeChat credentials", async () => {
  const { validateReleaseConfig } = await core();
  const result = validateReleaseConfig({
    env: {
      ...completeEnv,
      EMPLOYEE_LOGIN_MODE: "manual-review",
      VITE_EMPLOYEE_LOGIN_MODE: "manual-review",
      WECHAT_OA_APPID: "",
      WECHAT_OA_APP_SECRET: "",
      WECHAT_OAUTH_REDIRECT_URI: ""
    },
    cloudbaseConfig: { envId: "training-prod-123" }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test("rejects a frontend and function login mode mismatch", async () => {
  const { validateReleaseConfig } = await core();
  const result = validateReleaseConfig({
    env: { ...completeEnv, EMPLOYEE_LOGIN_MODE: "manual-review" },
    cloudbaseConfig: { envId: "training-prod-123" }
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.invalid, ["VITE_EMPLOYEE_LOGIN_MODE"]);
});

test("rejects wildcard origins and direct login in a release", async () => {
  const { validateReleaseConfig } = await core();
  const result = validateReleaseConfig({
    env: { ...completeEnv, WEB_ALLOWED_ORIGINS: "*", ALLOW_DIRECT_LOGIN: "true" },
    cloudbaseConfig: { envId: "training-prod-123" }
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.invalid, ["WEB_ALLOWED_ORIGINS", "ALLOW_DIRECT_LOGIN"]);
});

test("rejects demo mode, placeholder privacy contacts, and weak identity secrets", async () => {
  const { validateReleaseConfig } = await core();
  const result = validateReleaseConfig({
    env: {
      ...completeEnv,
      VITE_ENABLE_DEMO: "1",
      PRIVACY_CONTACT: "请联系管理员",
      EMPLOYEE_IDENTITY_HASH_SECRET: "short"
    },
    cloudbaseConfig: { envId: "training-prod-123" }
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.invalid, ["VITE_ENABLE_DEMO", "EMPLOYEE_IDENTITY_HASH_SECRET", "PRIVACY_CONTACT"]);
});
