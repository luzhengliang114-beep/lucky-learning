let accessTokenCache = {
  key: "",
  token: "",
  expiresAt: 0,
  promise: null
};

const invalidTokenCodes = new Set([40001, 40014, 42001]);
const riskyContentCodes = new Set([87014]);

function securityError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function parseJsonResponse(response) {
  if (!response?.ok) {
    throw securityError("CONTENT_SECURITY_UNAVAILABLE", "内容安全校验暂不可用");
  }

  try {
    return await response.json();
  } catch (error) {
    throw securityError("CONTENT_SECURITY_UNAVAILABLE", "内容安全校验暂不可用");
  }
}

function resetAccessToken() {
  accessTokenCache = {
    key: "",
    token: "",
    expiresAt: 0,
    promise: null
  };
}

async function getAccessToken({ appId, appSecret, fetchImpl = fetch, forceRefresh = false }) {
  if (!appId || !appSecret) {
    throw securityError("CONTENT_SECURITY_UNAVAILABLE", "内容安全校验暂不可用");
  }

  const key = `${appId}:${appSecret}`;
  const currentTime = Date.now();
  if (!forceRefresh && accessTokenCache.key === key && accessTokenCache.token && accessTokenCache.expiresAt > currentTime) {
    return accessTokenCache.token;
  }
  if (!forceRefresh && accessTokenCache.key === key && accessTokenCache.promise) {
    return accessTokenCache.promise;
  }

  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", appId);
  url.searchParams.set("secret", appSecret);

  const promise = (async () => {
    const body = await parseJsonResponse(await fetchImpl(url.toString()));
    if (!body.access_token) {
      throw securityError("CONTENT_SECURITY_UNAVAILABLE", "内容安全校验暂不可用");
    }

    accessTokenCache = {
      key,
      token: body.access_token,
      expiresAt: Date.now() + Math.max(60, Number(body.expires_in || 7200) - 300) * 1000,
      promise: null
    };
    return body.access_token;
  })();

  accessTokenCache = { key, token: "", expiresAt: 0, promise };
  try {
    return await promise;
  } catch (error) {
    resetAccessToken();
    throw error;
  }
}

async function callWechatSecurityApi({ appId, appSecret, fetchImpl, request, retried = false }) {
  let accessToken;
  let result;
  try {
    accessToken = await getAccessToken({
      appId,
      appSecret,
      fetchImpl,
      forceRefresh: retried
    });
    result = await request(accessToken);
  } catch (error) {
    if (error?.code === "CONTENT_SECURITY_UNAVAILABLE") {
      throw error;
    }
    throw securityError("CONTENT_SECURITY_UNAVAILABLE", "内容安全校验暂不可用");
  }

  if (!retried && invalidTokenCodes.has(Number(result.errcode))) {
    resetAccessToken();
    return callWechatSecurityApi({ appId, appSecret, fetchImpl, request, retried: true });
  }
  return result;
}

async function assertTextSafe({ content, openId, scene = 1, appId, appSecret, fetchImpl = fetch }) {
  const text = String(content || "").trim();
  if (!text) {
    return;
  }

  let result;
  try {
    result = await callWechatSecurityApi({
      appId,
      appSecret,
      fetchImpl,
      request: async (accessToken) => parseJsonResponse(await fetchImpl(
        `https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${encodeURIComponent(accessToken)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify({
            content: text,
            version: 2,
            scene,
            openid: openId
          })
        }
      ))
    });
  } catch (error) {
    throw securityError(error?.code || "CONTENT_SECURITY_UNAVAILABLE", "发布内容含违规信息");
  }

  if (Number(result.errcode || 0) !== 0) {
    if (riskyContentCodes.has(Number(result.errcode))) {
      throw securityError("CONTENT_TEXT_RISKY", "发布内容含违规信息");
    }
    throw securityError("CONTENT_SECURITY_UNAVAILABLE", "发布内容含违规信息");
  }
  if (result.result?.suggest !== "pass") {
    throw securityError("CONTENT_TEXT_RISKY", "发布内容含违规信息");
  }
}

function isImageFile(file = {}) {
  const contentType = String(file.contentType || "").toLowerCase();
  const filename = String(file.filename || "").toLowerCase();
  return contentType.startsWith("image/") || /\.(?:jpe?g|png|gif|webp)$/.test(filename);
}

function requiresImageSecurityCheck(file = {}, folder = "") {
  return String(folder || "").trim() === "employee-avatars" || isImageFile(file);
}

async function assertImageSafe({ file, appId, appSecret, fetchImpl = fetch }) {
  if (!file?.content || !Buffer.isBuffer(file.content)) {
    throw securityError("CONTENT_IMAGE_RISKY", "图片含违规内容");
  }

  const boundary = `----YueXueSecurity${Date.now().toString(16)}`;
  const filename = String(file.filename || "upload.jpg").replace(/["\r\n]/g, "");
  const contentType = String(file.contentType || "image/jpeg").replace(/[\r\n]/g, "");
  const multipartBody = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${filename}"\r\n`
      + `Content-Type: ${contentType}\r\n\r\n`
    ),
    file.content,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  let result;
  try {
    result = await callWechatSecurityApi({
      appId,
      appSecret,
      fetchImpl,
      request: async (accessToken) => parseJsonResponse(await fetchImpl(
        `https://api.weixin.qq.com/wxa/img_sec_check?access_token=${encodeURIComponent(accessToken)}`,
        {
          method: "POST",
          headers: {
            "content-type": `multipart/form-data; boundary=${boundary}`,
            "content-length": String(multipartBody.length)
          },
          body: multipartBody
        }
      ))
    });
  } catch (error) {
    throw securityError(error?.code || "CONTENT_SECURITY_UNAVAILABLE", "图片含违规内容");
  }

  if (Number(result.errcode || 0) !== 0) {
    if (riskyContentCodes.has(Number(result.errcode))) {
      throw securityError("CONTENT_IMAGE_RISKY", "图片含违规内容");
    }
    throw securityError("CONTENT_SECURITY_UNAVAILABLE", "图片含违规内容");
  }
}

module.exports = {
  assertImageSafe,
  assertTextSafe,
  isImageFile,
  requiresImageSecurityCheck,
  resetAccessToken
};
