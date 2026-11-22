const test = require("node:test");
const assert = require("node:assert/strict");

test("学习完成数同时包含视频、录音和考试，并在任务完成时显示产品完成", async () => {
  const { learningProgressSummary } = await import("../apps/employee/src/learningProgressCore.js");
  const summary = learningProgressSummary({
    courses: [
      { id: "video-1", productName: "产品一", learningCompleted: true },
      { id: "video-2", productName: "产品一", progress: 50 }
    ],
    phrases: [{ id: "phrase-1", productName: "产品一", maxRewardedAttempts: 1, completedCount: 1 }],
    exams: [{ id: "exam-1", productName: "产品一", completed: true }]
  });
  assert.deepEqual(summary, { completed: 3, total: 4, percent: 88 });

  const taskSummary = learningProgressSummary({
    courses: [{ id: "video-1", productName: "产品一", progress: 0 }],
    phrases: [{ id: "phrase-1", productName: "产品一", maxRewardedAttempts: 2, completedCount: 0 }],
    exams: [{ id: "exam-1", productName: "产品一", completed: false }],
    productTaskStatuses: [{ productKey: "产品一", status: "completed" }]
  });
  assert.deepEqual(taskSummary, { completed: 4, total: 4, percent: 100 });
});

test("部分视频和PPT进度计入综合百分比，但不冒充已完成项目", async () => {
  const { courseProgressPercent, learningProgressSummary } = await import("../apps/employee/src/learningProgressCore.js");
  const video = { id: "video-1", productName: "产品一", progress: 0, videoDurationSeconds: 100, videoProgress: { maxWatchedSeconds: 50, videoDurationSeconds: 100 } };
  assert.equal(courseProgressPercent(video), 50);
  const summary = learningProgressSummary({
    courses: [
      video,
      { id: "ppt-1", productName: "产品一", resourceType: "ppt", slideCount: 4, pptProgress: { unlockedSlides: 2 } }
    ],
    phrases: [],
    exams: []
  });
  assert.deepEqual(summary, { completed: 0, total: 2, percent: 50 });
});

test("fallback待办按真实视频、资料、录音和考试状态生成", async () => {
  const { learningTodoGroups } = await import("../apps/employee/src/learningProgressCore.js");
  const groups = learningTodoGroups({
    source: "fallback",
    courses: [
      { id: "video-1", status: "published", productName: "产品一", progress: 0, videoDurationSeconds: 100, videoProgress: { maxWatchedSeconds: 50, videoDurationSeconds: 100 } },
      { id: "ppt-1", status: "published", productName: "产品一", resourceType: "ppt", slideCount: 4, pptProgress: { unlockedSlides: 2 } },
      { id: "done-1", status: "published", productName: "产品二", learningCompleted: true }
    ],
    phrases: [{ id: "phrase-1", status: "published", productName: "产品一", completedCount: 0 }],
    exams: [{ id: "exam-1", status: "published", productName: "产品一", completed: false }],
    submissions: []
  });
  assert.equal(groups.reduce((sum, group) => sum + group.count, 0), 4);
  const progressByType = Object.fromEntries(groups[0].items.map((item) => [item.type, item.progress]));
  assert.deepEqual(progressByType, { audio: 0, exam: 0, material: 50, video: 50 });
  assert.equal(groups.some((group) => group.productName === "产品二"), false);
  assert.deepEqual(learningTodoGroups({ isSupplier: true, courses: [{ id: "video-1", status: "published" }] }), []);
});

test("前端待办与首页完成统计使用同一份状态，任务完成不会留下虚假待办", async () => {
  const { learningProgressSummary, learningTodoGroups } = await import("../apps/employee/src/learningProgressCore.js");
  const data = {
    courses: [{ id: "video-1", status: "published", productName: "产品一", progress: 100, learningCompleted: true }],
    phrases: [],
    exams: [],
    submissions: [],
    productTaskStatuses: []
  };
  const summary = learningProgressSummary(data);
  assert.equal(summary.completed, 1);
  assert.equal(learningTodoGroups(data).reduce((count, group) => count + group.count, 0), 0);
});
