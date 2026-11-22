const requiredEnvironmentNames = [
  "EMPLOYEE_LOGIN_MODE",
  "VITE_EMPLOYEE_LOGIN_MODE",
  "WEB_ALLOWED_ORIGINS",
  "WEB_SESSION_SECRET",
  "EMPLOYEE_IDENTITY_HASH_SECRET",
  "PRIVACY_CONTACT",
  "ALLOW_DIRECT_LOGIN",
  "ADMIN_REVIEW_SECRET",
  "ADMIN_ALLOWED_ORIGINS",
  "VITE_EMPLOYEE_API_ENDPOINT",
  "VITE_ADMIN_API_ENDPOINT"
];

function value(env, name) {
  return String(env?.[name] || "").trim();
}

function isHttpUrl(input) {
  try {
    const url = new URL(input);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  } catch {
    return false;
  }
}

export function validateReleaseConfig({ env = {}, cloudbaseConfig = {} } = {}) {
  const targetEnvId = String(env.CLOUDBASE_ENV_ID || cloudbaseConfig.envId || "").trim();
  const missing = [];
  if (!targetEnvId) missing.push("CLOUDBASE_ENV_ID");
  for (const name of requiredEnvironmentNames) {
    if (!value(env, name)) missing.push(name);
  }
  const employeeLoginMode = value(env, "EMPLOYEE_LOGIN_MODE");
  const frontendLoginMode = value(env, "VITE_EMPLOYEE_LOGIN_MODE");
  if (employeeLoginMode === "wechat-oauth") {
    for (const name of ["WECHAT_OA_APPID", "WECHAT_OA_APP_SECRET", "WECHAT_OAUTH_REDIRECT_URI"]) {
      if (!value(env, name)) missing.push(name);
    }
  }

  const invalid = [];
  if (!["wechat-oauth", "manual-review"].includes(employeeLoginMode)) invalid.push("EMPLOYEE_LOGIN_MODE");
  if (!["wechat-oauth", "manual-review"].includes(frontendLoginMode) || frontendLoginMode !== employeeLoginMode) invalid.push("VITE_EMPLOYEE_LOGIN_MODE");
  for (const name of ["WECHAT_OAUTH_REDIRECT_URI", "VITE_EMPLOYEE_API_ENDPOINT", "VITE_ADMIN_API_ENDPOINT"]) {
    if (value(env, name) && !isHttpUrl(value(env, name))) invalid.push(name);
  }
  for (const name of ["WEB_ALLOWED_ORIGINS", "ADMIN_ALLOWED_ORIGINS"]) {
    const configured = value(env, name);
    if (configured && (configured === "*" || configured.split(",").some((origin) => !isHttpUrl(origin.trim())))) invalid.push(name);
  }
  if (value(env, "ALLOW_DIRECT_LOGIN").toLowerCase() !== "false" && value(env, "ALLOW_DIRECT_LOGIN") !== "0") {
    invalid.push("ALLOW_DIRECT_LOGIN");
  }
  if (value(env, "VITE_ENABLE_DEMO") === "1") invalid.push("VITE_ENABLE_DEMO");
  if (value(env, "EMPLOYEE_IDENTITY_HASH_SECRET").length > 0 && value(env, "EMPLOYEE_IDENTITY_HASH_SECRET").length < 24) {
    invalid.push("EMPLOYEE_IDENTITY_HASH_SECRET");
  }
  if (value(env, "EMPLOYEE_IDENTITY_HASH_SECRET") && value(env, "EMPLOYEE_IDENTITY_HASH_SECRET") === value(env, "WEB_SESSION_SECRET")) {
    invalid.push("EMPLOYEE_IDENTITY_HASH_SECRET");
  }
  if (/示例|待配置|请联系管理员|example|demo/i.test(value(env, "PRIVACY_CONTACT"))) {
    invalid.push("PRIVACY_CONTACT");
  }

  return {
    ok: missing.length === 0 && invalid.length === 0,
    targetEnvId,
    missing,
    invalid
  };
}
