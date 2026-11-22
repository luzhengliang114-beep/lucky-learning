const test = require("node:test");
const assert = require("node:assert/strict");

async function learningAuditCore() {
  return import("../apps/admin/src/learningAuditCore.js");
}

test("后台学习核查区分从未进入、观看中、已完成和设备系统", async () => {
  const { buildEmployeeLearningAudit } = await learningAuditCore();
  const audit = buildEmployeeLearningAudit({
    employeeId: "employee-1",
    courses: [
      { id: "course-1", title: "视频一", productName: "产品A", status: "published" },
      { id: "course-2", title: "视频二", productName: "产品A", status: "published" },
      { id: "course-3", title: "视频三", productName: "产品A", status: "published" }
    ],
    courseProgress: [
      { employeeId: "employee-1", courseId: "course-1", progress: 48, clientContext: { platform: "android" }, updatedAt: "2026-10-16T10:00:00.000Z" },
      { employeeId: "employee-1", courseId: "course-2", progress: 100, videoWatchCompleted: true, clientContext: { platform: "ios" }, updatedAt: "2026-10-16T11:00:00.000Z" }
    ]
  });

  assert.equal(audit.hasActivity, true);
  assert.deepEqual(audit.courseRows.map((row) => [row.status, row.progress, row.platform]), [
    ["in-progress", 48, "android"],
    ["completed", 100, "ios"],
    ["not-started", 0, "unknown"]
  ]);
});

test("后台学习核查显示考试未通过和开口说完成次数", async () => {
  const { buildEmployeeLearningAudit } = await learningAuditCore();
  const audit = buildEmployeeLearningAudit({
    employeeId: "employee-1",
    exams: [{ id: "exam-1", title: "测评一", productName: "产品A", status: "published" }],
    examAttempts: [{ employeeId: "employee-1", examId: "exam-1", score: 80, passed: false, clientContext: { platform: "harmony" }, createdAt: "2026-10-16T12:00:00.000Z" }],
    phrases: [{ id: "phrase-1", title: "话术一", productName: "产品A", status: "published", maxRewardedAttempts: 2 }],
    phrasePracticeAttempts: [{ employeeId: "employee-1", phraseId: "phrase-1", passed: true, counted: true, createdAt: "2026-10-16T12:10:00.000Z" }]
  });

  assert.equal(audit.examRows[0].status, "failed");
  assert.equal(audit.examRows[0].score, 80);
  assert.equal(audit.examRows[0].platform, "harmony");
  assert.equal(audit.phraseRows[0].status, "in-progress");
  assert.equal(audit.phraseRows[0].completedCount, 1);
  assert.equal(audit.phraseRows[0].requiredCount, 2);
});
