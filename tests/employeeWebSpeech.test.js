const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getSpeechConfig,
  recognizeAudio
} = require("../cloudbase/functions/employeeWeb/speech");

const credentialKeys = [
  "ASR_SECRET_ID",
  "ASR_SECRET_KEY",
  "ASR_SESSION_TOKEN",
  "ASR_REGION",
  "TENCENTCLOUD_SECRETID",
  "TENCENTCLOUD_SECRETKEY",
  "TENCENTCLOUD_SESSIONTOKEN",
  "TENCENTCLOUD_TOKEN"
];

function withEnvironment(values, run) {
  const previous = Object.fromEntries(credentialKeys.map((key) => [key, process.env[key]]));
  for (const key of credentialKeys) delete process.env[key];
  Object.assign(process.env, values);
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const key of credentialKeys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

test("employee H5 speech uses CloudBase runtime credentials when ASR credentials are absent", async () => {
  await withEnvironment({
    TENCENTCLOUD_SECRETID: "runtime-id",
    TENCENTCLOUD_SECRETKEY: "runtime-key",
    TENCENTCLOUD_SESSIONTOKEN: "runtime-token"
  }, () => {
    assert.deepEqual(getSpeechConfig(), {
      secretId: "runtime-id",
      secretKey: "runtime-key",
      sessionToken: "runtime-token",
      region: "ap-shanghai"
    });
  });
});

test("employee H5 speech sends the CloudBase temporary session token", async () => {
  await withEnvironment({
    TENCENTCLOUD_SECRETID: "runtime-id",
    TENCENTCLOUD_SECRETKEY: "runtime-key",
    TENCENTCLOUD_SESSIONTOKEN: "runtime-token"
  }, async () => {
    const previousFetch = global.fetch;
    let requestHeaders;
    global.fetch = async (_url, options) => {
      requestHeaders = options.headers;
      return {
        ok: true,
        json: async () => ({ Response: { Result: "测试话术", RequestId: "request-id" } })
      };
    };
    try {
      const result = await recognizeAudio({ audio: Buffer.from("wav-data"), voiceFormat: "wav" });
      assert.equal(requestHeaders["X-TC-Token"], "runtime-token");
      assert.equal(result.text, "测试话术");
    } finally {
      global.fetch = previousFetch;
    }
  });
});
