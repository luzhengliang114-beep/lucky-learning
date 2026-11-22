const test = require("node:test");
const assert = require("node:assert/strict");

async function courseCompletionCore() {
  return import("../apps/employee/src/courseCompletionCore.js");
}

test("视频或 PPT 学习完成后无需领取金豆也计入产品完成数", async () => {
  const { courseLearningCompleted } = await courseCompletionCore();
  assert.equal(courseLearningCompleted({ id: "video-1", videoProgress: { videoWatchCompleted: true }, completed: false }), true);
  assert.equal(courseLearningCompleted({ id: "ppt-1", pptProgress: { readingCompleted: true }, completed: false }), true);
  assert.equal(courseLearningCompleted({ id: "legacy-1", progress: 100, completed: false }), true);
  assert.equal(courseLearningCompleted({ id: "pending-1", progress: 99, completed: false }), false);
});

test("刚播放完成的课程立即采用本地完成状态，不等待接口重新加载", async () => {
  const { courseLearningCompleted } = await courseCompletionCore();
  const completedCourseIds = new Set(["video-1"]);
  assert.equal(courseLearningCompleted({ id: "video-1", progress: 0 }, completedCourseIds), true);
  assert.equal(courseLearningCompleted({ id: "video-2", progress: 0 }, completedCourseIds), false);
});

test("课程 ID 兼容正式数据的 id 和 _id 字段", async () => {
  const { courseIdValue } = await courseCompletionCore();
  assert.equal(courseIdValue({ id: "course-id" }), "course-id");
  assert.equal(courseIdValue({ _id: "course-oid" }), "course-oid");
});
