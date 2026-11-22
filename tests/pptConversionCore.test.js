const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCloudFileId,
  buildOutputPrefix,
  parseCloudFileId,
  parseCosLocation,
  parseCreatedJob,
  parseJobResult,
  sortedSlideKeys
} = require("../cloudbase/functions/adminData/pptConversionCore");

test("parses CloudBase file IDs without exposing storage credentials", () => {
  assert.deepEqual(parseCloudFileId("cloud://env.bucket/admin-courses/resources/demo.pptx"), {
    authority: "env.bucket",
    key: "admin-courses/resources/demo.pptx"
  });
  assert.equal(buildCloudFileId("env.bucket", "slides/page-1.jpg"), "cloud://env.bucket/slides/page-1.jpg");
});

test("extracts COS bucket and region from a signed object URL", () => {
  assert.deepEqual(parseCosLocation("https://demo-1250000000.cos.ap-guangzhou.myqcloud.com/a.pptx?sign=secret"), {
    bucket: "demo-1250000000",
    region: "ap-guangzhou"
  });
});

test("supports configured COS location for CloudBase proxy URLs", () => {
  assert.deepEqual(parseCosLocation("https://example.tcb.qcloud.la/a.pptx", {
    bucket: "demo-1250000000",
    region: "ap-shanghai"
  }), {
    bucket: "demo-1250000000",
    region: "ap-shanghai"
  });
});

test("builds an isolated output prefix for each uploaded PPT", () => {
  assert.equal(
    buildOutputPrefix("admin-courses/resources/培训课件.pptx", 1234, "abcd"),
    "admin-courses/ppt-slides/-----1234-abcd/page-"
  );
});

test("sorts converted pages numerically and ignores unrelated files", () => {
  assert.deepEqual(sortedSlideKeys([
    { Key: "slides/page-10.jpg" },
    { Key: "slides/readme.txt" },
    { Key: "slides/page-2.jpg" },
    { Key: "other/page-1.jpg" },
    { Key: "slides/page-1.jpg" }
  ], "slides/page-"), [
    "slides/page-1.jpg",
    "slides/page-2.jpg",
    "slides/page-10.jpg"
  ]);
});

test("normalizes Tencent CI job responses", () => {
  assert.equal(parseCreatedJob({ JobsDetail: { JobId: "job-1" } }), "job-1");
  assert.deepEqual(parseJobResult({ JobsDetail: { State: "Success" } }), {
    state: "ready",
    errorCode: "",
    errorMessage: ""
  });
  assert.deepEqual(parseJobResult({ Response: { JobsDetail: { State: "Failed", Code: "BadFile", Message: "broken" } } }), {
    state: "failed",
    errorCode: "BadFile",
    errorMessage: "broken"
  });
});
