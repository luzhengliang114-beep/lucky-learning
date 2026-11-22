const test = require("node:test");
const assert = require("node:assert/strict");

async function core() {
  return import("../apps/employee/src/courseMaterialCore.js");
}

test("PPT courses are ready only after slide images are configured", async () => {
  const { isPptCourse, isPptSlideDeckReady, courseResourceLabel } = await core();

  assert.equal(isPptCourse({ resourceType: "ppt" }), true);
  assert.equal(isPptSlideDeckReady({ resourceType: "ppt", slideCount: 0, slideImagePrefix: "" }), false);
  assert.equal(isPptSlideDeckReady({ resourceType: "ppt", slideCount: 12, slideImagePrefix: "ppt/test/page-" }), true);
  assert.equal(isPptSlideDeckReady({ resourceType: "ppt", slideCount: 2, slideImageUrls: ["one.jpg", "two.jpg"] }), true);
  assert.equal(isPptSlideDeckReady({ resourceType: "ppt", slideCount: 2, slideImageUrls: ["one.jpg"] }), false);
  assert.equal(courseResourceLabel({ resourceType: "ppt", slideCount: 0, slideImagePrefix: "" }), "PPT页面待生成");
  assert.equal(courseResourceLabel({ resourceType: "ppt", slideCount: 12, slideImagePrefix: "ppt/test/page-" }), "PPT · 12页");
});
