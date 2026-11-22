const test = require("node:test");
const assert = require("node:assert/strict");

const {
  courseLearningCompleted,
  courseProgressByCourseId,
  progressForEmployee
} = require("../cloudbase/functions/employeeWeb/courseProgressSummaryCore");

test("课程汇总兼容字符串和对象形式的员工、课程 ID", () => {
  const employeeId = { toString: () => "employee-1" };
  const courseId = { toString: () => "course-1" };
  const records = [
    { employeeId: "employee-1", courseId, progress: 100, videoWatchCompleted: true },
    { employeeId: "employee-2", courseId: "course-2", completed: true }
  ];

  const employeeProgress = progressForEmployee(records, employeeId);
  const progressByCourse = courseProgressByCourseId(employeeProgress);

  assert.equal(employeeProgress.length, 1);
  assert.equal(progressByCourse.get("course-1")?.progress, 100);
});

test("课程汇总兼容 CloudBase 返回的 $oid ID", () => {
  const employeeProgress = progressForEmployee([
    {
      employeeId: { $oid: "employee-oid" },
      courseId: { $oid: "course-oid" },
      progress: 100,
      videoWatchCompleted: true
    }
  ], { $oid: "employee-oid" });

  const progress = courseProgressByCourseId(employeeProgress).get("course-oid");
  assert.equal(progress?.progress, 100);
  assert.equal(courseLearningCompleted(progress), true);
});

test("完整看完视频或读完 PPT 都计入产品学习进度，但不冒充领取记录", () => {
  assert.equal(courseLearningCompleted({ videoWatchCompleted: true, completed: false }), true);
  assert.equal(courseLearningCompleted({ readingCompleted: true, completed: false }), true);
  assert.equal(courseLearningCompleted({ completed: true }), true);
  assert.equal(courseLearningCompleted({ progress: 100, completed: false }), true);
  assert.equal(courseLearningCompleted({ progress: 99 }), false);
});

test("同一课程存在重复进度记录时保留最高学习进度和完成状态", () => {
  const progressByCourse = courseProgressByCourseId([
    {
      employeeId: "employee-1",
      courseId: "course-1",
      progress: 100,
      maxWatchedSeconds: 120,
      videoDurationSeconds: 120,
      videoWatchCompleted: true,
      updatedAt: "2026-09-24T03:00:00.000Z"
    },
    {
      employeeId: "employee-1",
      courseId: "course-1",
      progress: 0,
      maxWatchedSeconds: 0,
      videoDurationSeconds: 120,
      videoWatchCompleted: false,
      updatedAt: "2026-09-24T02:00:00.000Z"
    }
  ]);

  const progress = progressByCourse.get("course-1");
  assert.equal(progress.progress, 100);
  assert.equal(progress.maxWatchedSeconds, 120);
  assert.equal(progress.videoWatchCompleted, true);
  assert.equal(courseLearningCompleted(progress), true);
});
