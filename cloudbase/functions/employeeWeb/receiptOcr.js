const crypto = require("node:crypto");

const service = "ocr";
const host = "ocr.tencentcloudapi.com";
const version = "2018-11-19";
const action = "GeneralAccurateOCR";
const fallbackAction = "GeneralBasicOCR";

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function config() {
  return {
    secretId: String(process.env.OCR_SECRET_ID || process.env.TENCENTCLOUD_SECRETID || process.env.TENCENTCLOUD_SECRET_ID || "").trim(),
    secretKey: String(process.env.OCR_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY || process.env.TENCENTCLOUD_SECRET_KEY || "").trim(),
    sessionToken: String(process.env.OCR_SESSION_TOKEN || process.env.TENCENTCLOUD_SESSIONTOKEN || process.env.TENCENTCLOUD_SESSION_TOKEN || process.env.TENCENTCLOUD_TOKEN || "").trim(),
    region: String(process.env.OCR_REGION || process.env.TENCENTCLOUD_REGION || process.env.SCF_REGION || "ap-shanghai").trim()
  };
}

function isUnsupportedAction(error) {
  return /invalid.?action|action.*not.?found|unsupported.*action/i.test(String(error?.code || ""))
    || /action.*invalid|action.*not found|unsupported.*action/i.test(String(error?.message || ""));
}

async function recognizeReceipt(image, { fetchImpl = fetch } = {}) {
  const settings = config();
  if (!settings.secretId || !settings.secretKey) {
    const error = new Error("小票识别服务未配置");
    error.code = "RECEIPT_OCR_NOT_CONFIGURED";
    throw error;
  }
  const payload = {
    ImageBase64: Buffer.isBuffer(image) ? image.toString("base64") : String(image || "")
  };
  const payloadText = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, "content-type;host", sha256(payloadText)].join("\n");
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", timestamp, credentialScope, sha256(canonicalRequest)].join("\n");
  const secretDate = hmac(`TC3${settings.secretKey}`, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = hmac(secretSigning, stringToSign, "hex");
  for (const actionName of [action, fallbackAction]) {
    const headers = {
      Authorization: `TC3-HMAC-SHA256 Credential=${settings.secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`,
      "Content-Type": "application/json; charset=utf-8",
      Host: host,
      "X-TC-Action": actionName,
      "X-TC-Version": version,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Region": settings.region
    };
    if (settings.sessionToken) headers["X-TC-Token"] = settings.sessionToken;
    const response = await fetchImpl(`https://${host}`, { method: "POST", headers, body: payloadText });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.Response?.Error) {
      const error = new Error(body.Response?.Error?.Message || "小票识别失败");
      error.code = body.Response?.Error?.Code || `RECEIPT_OCR_HTTP_${response.status}`;
      if (actionName === action && isUnsupportedAction(error)) continue;
      throw error;
    }
    return {
      textDetections: Array.isArray(body.Response?.TextDetections) ? body.Response.TextDetections : [],
      requestId: body.Response?.RequestId || ""
    };
  }
  throw new Error("小票识别服务不支持当前 OCR 接口");
}

module.exports = { action, fallbackAction, recognizeReceipt };
