const test = require("node:test");
const assert = require("node:assert/strict");

const {
  chunkCloudFileIds,
  configuredSubmissionReward,
  corsOriginForRequest,
  examAttemptsRemaining,
  isPrivateReceiptUploadFolder,
  learningCompletionRate,
  normalizeCaseMedia,
  parseMediaDataUrl,
  phraseCompletionCount,
  visibleCasePosts,
  voiceFormatForContentType
} = require("../cloudbase/functions/employeeWeb/core");

test("CloudBase 临时文件链接按最多 50 个分批，支持 54 页 PPT", () => {
  const fileIds = Array.from({ length: 54 }, (_, index) => `cloud://env/slides/${index + 1}.jpg`);
  const batches = chunkCloudFileIds([...fileIds, fileIds[0], "https://example.com/not-cloud.jpg"]);
  assert.deepEqual(batches.map((batch) => batch.length), [50, 4]);
  assert.deepEqual(batches.flat(), fileIds);
});

test("exam attempts are limited to two per paper", () => {
  assert.equal(examAttemptsRemaining(0), 2);
  assert.equal(examAttemptsRemaining(1), 1);
  assert.equal(examAttemptsRemaining(2), 0);
  assert.equal(examAttemptsRemaining(9), 0);
});

test("H5 CORS accepts only configured or OAuth redirect origins", () => {
  assert.equal(corsOriginForRequest("https://learn.example.com", "", "https://learn.example.com/employee/"), "https://learn.example.com");
  assert.equal(corsOriginForRequest("http://localhost:5174", "http://localhost:5174, https://staging.example.com", "https://learn.example.com/employee/"), "http://localhost:5174");
  assert.equal(corsOriginForRequest("https://attacker.example", "", "https://learn.example.com/employee/"), "");
});

test("H5 media parser accepts recorder MIME parameters and chooses a server folder", () => {
  const parsed = parseMediaDataUrl("data:audio/webm;codecs=opus;base64,aGVsbG8=");
  assert.equal(parsed.contentType, "audio/webm");
  assert.equal(parsed.folder, "employee-web/recordings");
  assert.equal(parsed.extension, "webm");
  assert.equal(parsed.content.toString(), "hello");
});

test("H5 media parser rejects unsupported client-declared types", () => {
  assert.throws(() => parseMediaDataUrl("data:text/html;base64,PGgxPmhpPC9oMT4="), (error) => error.code === "FILE_TYPE_INVALID");
});

test("小票上传目录不触发公开图片内容安全校验，其他目录仍按原规则处理", () => {
  assert.equal(isPrivateReceiptUploadFolder("employee-web/store-receipts"), true);
  assert.equal(isPrivateReceiptUploadFolder("employee-web/cases/images"), false);
  assert.equal(isPrivateReceiptUploadFolder(""), false);
});

test("H5 speech recognition derives a server-controlled voice format", () => {
  assert.equal(voiceFormatForContentType("audio/wav"), "wav");
  assert.equal(voiceFormatForContentType("audio/mp4"), "m4a");
  assert.throws(() => voiceFormatForContentType("audio/webm;codecs=opus"), (error) => error.code === "PHRASE_AUDIO_FORMAT_UNSUPPORTED");
});

test("case media accepts cloud images and strips temporary URLs", () => {
  assert.deepEqual(normalizeCaseMedia({ images: [{ fileId: "cloud://env/image.jpg", url: "https://expired.example/image.jpg", width: 100 }] }), {
    images: [{ fileId: "cloud://env/image.jpg", width: 100, height: 0, size: 0 }],
    videoFileId: ""
  });
});

test("case media rejects mixed, excessive, and external media", () => {
  assert.throws(() => normalizeCaseMedia({ images: [{ fileId: "cloud://env/image.jpg" }], videoFileId: "cloud://env/video.mp4" }), (error) => error.code === "MIXED_CASE_MEDIA");
  assert.throws(() => normalizeCaseMedia({ images: Array.from({ length: 10 }, (_, index) => ({ fileId: `cloud://env/${index}.jpg` })) }), (error) => error.code === "TOO_MANY_IMAGES");
  assert.throws(() => normalizeCaseMedia({ images: [{ fileId: "https://attacker.example/image.jpg" }] }), (error) => error.code === "INVALID_IMAGE_FILE");
});

test("submission rewards ignore client values and use server configuration", () => {
  assert.equal(configuredSubmissionReward({ case: 12 }, "case", { case: 0 }), 12);
  assert.equal(configuredSubmissionReward({ case: -10 }, "case", { case: 3 }), 3);
  assert.equal(configuredSubmissionReward({}, "case", { case: 3 }), 3);
});

test("learning completion rate combines courses, phrase repetitions, and passed exams", () => {
  assert.equal(learningCompletionRate(), 0);
  assert.equal(learningCompletionRate({
    courses: [
      { completed: true },
      { completed: false }
    ],
    phrases: [
      { maxRewardedAttempts: 2, completedCount: 2 },
      { maxRewardedAttempts: 2, completedCount: 1 }
    ],
    exams: [
      { completed: true },
      { completed: false }
    ]
  }), 63);
  assert.equal(learningCompletionRate({
    courses: [{ completed: true }],
    phrases: [{ maxRewardedAttempts: 2, completedCount: 9 }],
    exams: [{ completed: true }]
  }), 100);
});

test("employee case feed shows approved cases across stores, excluding deleted and pending posts", () => {
  const visible = visibleCasePosts([
    { id: "approved", storeId: "store-1", status: "approved", createdAt: "2026-08-12T09:00:00Z" },
    { id: "deleted", storeId: "store-1", status: "approved", deletedAt: "2026-08-12T09:01:00Z", createdAt: "2026-08-12T09:01:00Z" },
    { id: "pending", storeId: "store-1", status: "pending", createdAt: "2026-08-12T09:02:00Z" },
    { id: "other-store", storeId: "store-2", status: "published", createdAt: "2026-08-12T09:03:00Z" },
    { id: "published", storeId: "store-1", status: "published", createdAt: "2026-08-12T09:04:00Z" }
  ], "store-1");
  assert.deepEqual(visible.map((item) => item.id), ["published", "other-store", "approved"]);
});

test("phrase completion counts only successful counted attempts and respects legacy rewards", () => {
  const attempts = [
    { phraseId: "p1", passed: true },
    { phraseId: "p1", passed: false },
    { phraseId: "p1", passed: true, counted: false },
    { phraseId: "p2", passed: true }
  ];
  assert.equal(phraseCompletionCount({ attempts, phraseId: "p1", maxRewardedAttempts: 3 }), 1);
  assert.equal(phraseCompletionCount({ attempts, ledger: [{ sourceId: "p1-1", delta: 2 }, { sourceId: "p1-2", delta: 2 }], phraseId: "p1", maxRewardedAttempts: 3 }), 2);
  assert.equal(phraseCompletionCount({ attempts: [...attempts, { phraseId: "p1", passed: true }], ledger: [{ sourceId: "p1-3", delta: 2 }], phraseId: "p1", maxRewardedAttempts: 2 }), 2);
});
