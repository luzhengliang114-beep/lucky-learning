const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertImageSafe,
  assertTextSafe,
  isImageFile,
  requiresImageSecurityCheck,
  resetAccessToken
} = require("../cloudbase/functions/miniProgramApi/contentSecurity");

function jsonResponse(body, ok = true) {
  return {
    ok,
    async json() {
      return body;
    }
  };
}

test.beforeEach(() => resetAccessToken());

test("text publishing passes only when WeChat returns pass", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    return requests.length === 1
      ? jsonResponse({ access_token: "token", expires_in: 7200 })
      : jsonResponse({ errcode: 0, result: { suggest: "pass" } });
  };

  await assertTextSafe({
    content: "合规案例内容",
    openId: "openid-1",
    scene: 4,
    appId: "appid",
    appSecret: "secret",
    fetchImpl
  });

  assert.equal(requests.length, 2);
  assert.match(requests[1].url, /msg_sec_check/);
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    content: "合规案例内容",
    version: 2,
    scene: 4,
    openid: "openid-1"
  });
});

test("unsafe text returns a generic publishing error", async () => {
  const fetchImpl = async (url) => url.includes("cgi-bin/token")
    ? jsonResponse({ access_token: "token", expires_in: 7200 })
    : jsonResponse({ errcode: 0, result: { suggest: "risky" } });

  await assert.rejects(
    assertTextSafe({
      content: "unsafe",
      openId: "openid-1",
      appId: "appid",
      appSecret: "secret",
      fetchImpl
    }),
    (error) => error.code === "CONTENT_TEXT_RISKY" && error.message === "发布内容含违规信息"
  );
});

test("image uploads are checked before storage", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    return requests.length === 1
      ? jsonResponse({ access_token: "token", expires_in: 7200 })
      : jsonResponse({ errcode: 0, errmsg: "ok" });
  };
  const file = {
    filename: "avatar.jpg",
    contentType: "image/jpeg",
    content: Buffer.from("image-bytes")
  };

  await assertImageSafe({ file, appId: "appid", appSecret: "secret", fetchImpl });

  assert.equal(isImageFile(file), true);
  assert.match(requests[1].url, /img_sec_check/);
  assert.equal(Buffer.isBuffer(requests[1].options.body), true);
  assert.equal(requests[1].options.body.includes(file.content), true);
});

test("avatar uploads always require image security even without a file extension", () => {
  assert.equal(requiresImageSecurityCheck({
    filename: "tmp-file",
    contentType: "application/octet-stream"
  }, "employee-avatars"), true);
  assert.equal(requiresImageSecurityCheck({
    filename: "recording.mp3",
    contentType: "audio/mpeg"
  }, "phrase-recordings"), false);
});

test("unsafe images return only the generic image message", async () => {
  const fetchImpl = async (url) => url.includes("cgi-bin/token")
    ? jsonResponse({ access_token: "token", expires_in: 7200 })
    : jsonResponse({ errcode: 87014, errmsg: "risky content" });

  await assert.rejects(
    assertImageSafe({
      file: {
        filename: "avatar.png",
        contentType: "image/png",
        content: Buffer.from("unsafe-image")
      },
      appId: "appid",
      appSecret: "secret",
      fetchImpl
    }),
    (error) => error.code === "CONTENT_IMAGE_RISKY" && error.message === "图片含违规内容"
  );
});

test("security service failures fail closed with generic messages", async () => {
  const fetchImpl = async () => {
    throw new Error("network details must not reach the user");
  };

  await assert.rejects(
    assertTextSafe({
      content: "待发布内容",
      openId: "openid-1",
      appId: "appid",
      appSecret: "secret",
      fetchImpl
    }),
    (error) => error.code === "CONTENT_SECURITY_UNAVAILABLE" && error.message === "发布内容含违规信息"
  );
  resetAccessToken();
  await assert.rejects(
    assertImageSafe({
      file: {
        filename: "avatar.jpg",
        contentType: "image/jpeg",
        content: Buffer.from("image")
      },
      appId: "appid",
      appSecret: "secret",
      fetchImpl
    }),
    (error) => error.code === "CONTENT_SECURITY_UNAVAILABLE" && error.message === "图片含违规内容"
  );
});
