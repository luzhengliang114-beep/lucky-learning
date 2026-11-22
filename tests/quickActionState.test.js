const test = require("node:test");
const assert = require("node:assert/strict");

async function quickActionState() {
  return import("../apps/employee/src/quickActionStateCore.js");
}

function state() {
  return {
    employee: {
      id: "employee-1",
      goldenBeans: 10,
      notificationRequiredCount: 5,
      notificationAcknowledgedCount: 1,
      notificationAcknowledgementRate: 20,
      pendingNotifications: [{ caseId: "case-1" }, { caseId: "case-2" }]
    },
    cases: [{
      id: "case-1",
      acknowledgementStatus: "pending",
      acknowledgementTargetCount: 195,
      acknowledgementAcknowledgedCount: 8,
      acknowledgementPendingCount: 187
    }],
    courses: [{ id: "course-1", completed: false, learningCompleted: true, progress: 100 }],
    ranking: [{
      id: "employee-1",
      goldenBeans: 10,
      notificationRequiredCount: 5,
      notificationAcknowledgedCount: 1,
      notificationAcknowledgementRate: 20,
      pendingNotifications: [{ caseId: "case-1" }, { caseId: "case-2" }]
    }]
  };
}

test("确认通知后立即更新按钮、红点、确认人数和个人接收率", async () => {
  const { applyCaseAcknowledgement } = await quickActionState();
  const next = applyCaseAcknowledgement(state(), "case-1", "2026-10-15T12:00:00.000Z");

  assert.equal(next.cases[0].acknowledgementStatus, "acknowledged");
  assert.equal(next.cases[0].acknowledgementAcknowledgedCount, 9);
  assert.equal(next.cases[0].acknowledgementPendingCount, 186);
  assert.deepEqual(next.employee.pendingNotifications, [{ caseId: "case-2" }]);
  assert.equal(next.employee.notificationAcknowledgementRate, 40);
  assert.deepEqual(next.ranking[0].pendingNotifications, [{ caseId: "case-2" }]);
});

test("领取课程金豆后立即更新课程状态、余额和本人排行", async () => {
  const { applyCourseReward } = await quickActionState();
  const next = applyCourseReward(state(), "course-1", { goldenBeans: 30, award: { delta: 20 } });

  assert.equal(next.courses[0].completed, true);
  assert.equal(next.courses[0].progress, 100);
  assert.equal(next.employee.goldenBeans, 30);
  assert.equal(next.ranking[0].goldenBeans, 30);
});

test("重学产品的最后一项点击完成后立即恢复两次考试机会", async () => {
  const { applyCourseReward } = await quickActionState();
  const current = {
    ...state(),
    courses: [
      { id: "course-1", productName: "产品A", track: "product", completed: true },
      { id: "course-2", productName: "产品A", track: "product", completed: true },
      { id: "course-3", productName: "产品A", track: "product", completed: false }
    ],
    exams: [{ id: "exam-1", productName: "产品A", learningResetRequired: true, attemptCount: 1, attemptsRemaining: 1 }]
  };

  const next = applyCourseReward(current, "course-3", { goldenBeans: 10, award: { delta: 0 } });

  assert.equal(next.courses[2].completed, true);
  assert.equal(next.exams[0].learningResetRequired, false);
  assert.equal(next.exams[0].attemptCount, 0);
  assert.equal(next.exams[0].attemptsRemaining, 2);
});

test("重学产品仍有资料未点击完成时保持考试锁定", async () => {
  const { applyCourseReward } = await quickActionState();
  const current = {
    ...state(),
    courses: [
      { id: "course-1", productName: "产品A", track: "product", completed: false },
      { id: "course-2", productName: "产品A", track: "product", completed: false }
    ],
    exams: [{ id: "exam-1", productName: "产品A", learningResetRequired: true, attemptCount: 1, attemptsRemaining: 1 }]
  };

  const next = applyCourseReward(current, "course-1", { goldenBeans: 10, award: { delta: 0 } });

  assert.equal(next.exams[0].learningResetRequired, true);
  assert.equal(next.exams[0].attemptsRemaining, 1);
});

test("考试通过后立即更新分数相关状态和金豆，不等待全量刷新", async () => {
  const { applyExamResult } = await quickActionState();
  const current = {
    ...state(),
    exams: [{ id: "exam-1", productName: "产品A", completed: false, attemptCount: 0, attemptsRemaining: 2 }],
    courses: [{ id: "course-1", productName: "产品A", learningCompleted: true, progress: 100 }],
    phrases: []
  };
  const next = applyExamResult(current, "exam-1", {
    passed: true,
    attemptsUsed: 1,
    attemptsRemaining: 1,
    relearningRequired: false,
    goldenBeans: 28,
    award: { delta: 18 }
  });

  assert.equal(next.exams[0].completed, true);
  assert.equal(next.exams[0].attemptsRemaining, 1);
  assert.equal(next.employee.goldenBeans, 28);
  assert.equal(next.ranking[0].goldenBeans, 28);
  assert.equal(next.courses[0].progress, 100);
});

test("第一次考试未通过后保留课程进度并开放第二次考试", async () => {
  const { applyExamResult } = await quickActionState();
  const current = {
    ...state(),
    exams: [{ id: "exam-1", productName: "产品A", completed: false, attemptCount: 0, attemptsRemaining: 2 }],
    courses: [{ id: "course-1", productName: "产品A", completed: true, learningCompleted: true, progress: 100, videoProgress: { maxWatchedSeconds: 60, videoDurationSeconds: 60, videoWatchCompleted: true } }],
    phrases: []
  };
  const next = applyExamResult(current, "exam-1", {
    passed: false,
    attemptsUsed: 1,
    attemptsRemaining: 1,
    relearningRequired: false,
    goldenBeans: 10
  });

  assert.equal(next.exams[0].learningResetRequired, false);
  assert.equal(next.exams[0].attemptsRemaining, 1);
  assert.equal(next.courses[0].learningCompleted, true);
  assert.equal(next.courses[0].progress, 100);
  assert.equal(next.courses[0].videoProgress.videoWatchCompleted, true);
});

test("第二次考试未通过后才重置对应产品课程", async () => {
  const { applyExamResult } = await quickActionState();
  const current = {
    ...state(),
    exams: [{ id: "exam-1", productName: "产品A", completed: false, attemptCount: 1, attemptsRemaining: 1 }],
    courses: [
      { id: "course-1", productName: "产品A", completed: true, learningCompleted: true, progress: 100, videoProgress: { maxWatchedSeconds: 60, videoDurationSeconds: 60, videoWatchCompleted: true } },
      { id: "course-2", productName: "产品B", completed: true, learningCompleted: true, progress: 100 }
    ],
    phrases: []
  };
  const next = applyExamResult(current, "exam-1", {
    passed: false,
    attemptsUsed: 2,
    attemptsRemaining: 0,
    relearningRequired: true,
    goldenBeans: 10
  });

  assert.equal(next.exams[0].learningResetRequired, true);
  assert.equal(next.courses[0].learningCompleted, false);
  assert.equal(next.courses[0].progress, 0);
  assert.equal(next.courses[0].videoProgress.videoWatchCompleted, false);
  assert.equal(next.courses[1].progress, 100);
});

test("开口说成功后立即更新完成次数和金豆", async () => {
  const { applyPhraseResult } = await quickActionState();
  const current = {
    ...state(),
    exams: [],
    phrases: [{ id: "phrase-1", completedCount: 0 }]
  };
  const next = applyPhraseResult(current, "phrase-1", {
    completedCount: 1,
    goldenBeans: 15,
    award: { delta: 5 }
  });

  assert.equal(next.phrases[0].completedCount, 1);
  assert.equal(next.employee.goldenBeans, 15);
  assert.equal(next.ranking[0].goldenBeans, 15);
});
