const crypto = require("node:crypto");

const service = "asr";
const host = "asr.tencentcloudapi.com";
const version = "2019-06-14";

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeSpeechText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[，。！？；：、,.!?;:'"“”‘’（）()\[\]{}<>《》]/g, "")
    .replace(/[\s\u3000]/g, "")
    .replace(/嗯|啊|呃|那个|就是/g, "")
    .toLowerCase();
}

function levenshteinDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index];
    }
  }
  return previous[right.length];
}

function compareSpeechText(expected, actual) {
  const expectedText = normalizeSpeechText(expected);
  const actualText = normalizeSpeechText(actual);
  if (!expectedText || !actualText) {
    return { matched: false, score: 0, expectedText, actualText };
  }
  const distance = levenshteinDistance(expectedText, actualText);
  const score = Math.max(0, Math.round((1 - distance / Math.max(expectedText.length, actualText.length)) * 100));
  const threshold = Number(process.env.ASR_MATCH_THRESHOLD || 65);
  return { matched: score >= threshold, score, expectedText, actualText };
}

function getSpeechConfig() {
  return {
    secretId: String(process.env.ASR_SECRET_ID || process.env.TENCENTCLOUD_SECRETID || "").trim(),
    secretKey: String(process.env.ASR_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY || "").trim(),
    sessionToken: String(
      process.env.ASR_SESSION_TOKEN ||
      process.env.TENCENTCLOUD_SESSIONTOKEN ||
      process.env.TENCENTCLOUD_TOKEN ||
      ""
    ).trim(),
    region: String(process.env.ASR_REGION || "ap-shanghai").trim()
  };
}

function buildAuthorization(config, payload, timestamp, nonce) {
  const payloadText = JSON.stringify(payload);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    sha256(payloadText)
  ].join("\n");
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    "TC3-HMAC-SHA256",
    timestamp,
    credentialScope,
    sha256(canonicalRequest)
  ].join("\n");
  const secretDate = hmac(`TC3${config.secretKey}`, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = hmac(secretSigning, stringToSign, "hex");

  return {
    payloadText,
    authorization: `TC3-HMAC-SHA256 Credential=${config.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    nonce
  };
}

async function recognizeAudio({ audio, voiceFormat = "mp3" }) {
  const config = getSpeechConfig();
  if (!config.secretId || !config.secretKey) {
    const error = new Error("语音识别服务未配置");
    error.code = "SPEECH_NOT_CONFIGURED";
    throw error;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = Math.floor(Math.random() * 1e9);
  const payload = {
    EngSerViceType: "16k_zh",
    SourceType: 1,
    VoiceFormat: voiceFormat,
    UsrAudioKey: `phrase-${timestamp}-${nonce}`,
    Data: Buffer.isBuffer(audio) ? audio.toString("base64") : String(audio || ""),
    DataLen: Buffer.isBuffer(audio) ? audio.length : Buffer.from(String(audio || ""), "base64").length,
    FilterDirty: 1,
    FilterModal: 0,
    FilterPunc: 0,
    ConvertNumMode: 1,
    HotwordId: "",
    WordInfo: 0
  };
  const signed = buildAuthorization(config, payload, timestamp, nonce);
  const headers = {
    Authorization: signed.authorization,
    "Content-Type": "application/json; charset=utf-8",
    Host: host,
    "X-TC-Action": "SentenceRecognition",
    "X-TC-Version": version,
    "X-TC-Timestamp": String(timestamp),
    "X-TC-Region": config.region,
    "X-TC-Nonce": String(nonce)
  };
  if (config.sessionToken) headers["X-TC-Token"] = config.sessionToken;

  const response = await fetch(`https://${host}`, {
    method: "POST",
    headers,
    body: signed.payloadText
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.Response?.Error) {
    const error = new Error(body.Response?.Error?.Message || "语音识别失败");
    error.code = body.Response?.Error?.Code || `SPEECH_HTTP_${response.status}`;
    throw error;
  }

  return {
    text: String(body.Response?.Result || "").trim(),
    requestId: body.Response?.RequestId || ""
  };
}

module.exports = {
  compareSpeechText,
  getSpeechConfig,
  normalizeSpeechText,
  recognizeAudio
};
