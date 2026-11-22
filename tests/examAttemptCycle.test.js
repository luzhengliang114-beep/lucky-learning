const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  resolveExamAttemptCycle
} = require("../cloudbase/functions/employeeWeb/examAttemptCycleCore");

const failedAttempts = [
  { id: "a1", attemptCycle: 0, passed: false, createdAt: "2026-09-08T01:00:00.000Z" },
  { id: "a2", attemptCycle: 0, passed: false, createdAt: "2026-09-08T02:00:00.000Z" }
];

test("第一次未通过保留学习进度并开放第二次考试", () => {
  const state = resolveExamAttemptCycle({
    attempts: [failedAttempts[0]],
    requiredCourseIds: ["video-1", "ppt-1"],
    courseProgress: [
      { courseId: "video-1", completed: true, updatedAt: "2026-09-08T00:50:00.000Z" },
      { courseId: "ppt-1", completed: true, updatedAt: "2026-09-08T00:55:00.000Z" }
    ]
  });

  assert.equal(state.cycle, 0);
  assert.equal(state.attemptsUsed, 1);
  assert.equal(state.attemptsRemaining, 1);
  assert.equal(state.relearningRequired, false);
  assert.equal(state.unlockedByRelearning, false);
});

test("旧试卷两次失败且课程未重学时保持锁定并提示重学", () => {
  const state = resolveExamAttemptCycle({
    attempts: failedAttempts.map(({ attemptCycle, ...attempt }) => attempt),
    requiredCourseIds: ["video-1", "ppt-1"],
    courseProgress: [
      { courseId: "video-1", completed: false, updatedAt: "2026-09-08T02:00:01.000Z" },
      { courseId: "ppt-1", completed: false, updatedAt: "2026-09-08T02:00:01.000Z" }
    ]
  });

  assert.equal(state.cycle, 0);
  assert.equal(state.attemptsUsed, 2);
  assert.equal(state.attemptsRemaining, 0);
  assert.equal(state.relearningRequired, true);
});

test("最近一次失败后完成全部产品课程会开启新周期并恢复两次机会", () => {
  const state = resolveExamAttemptCycle({
    attempts: failedAttempts,
    requiredCourseIds: ["video-1", "ppt-1"],
    courseProgress: [
      { courseId: "video-1", completed: true, updatedAt: "2026-09-08T03:00:00.000Z" },
      { courseId: "ppt-1", completed: true, updatedAt: "2026-09-08T03:05:00.000Z" }
    ]
  });

  assert.equal(state.cycle, 1);
  assert.equal(state.attemptsUsed, 0);
  assert.equal(state.attemptsRemaining, 2);
  assert.equal(state.relearningRequired, false);
  assert.equal(state.unlockedByRelearning, true);
});

test("视频重新完整播放后仍需点击完成才恢复考试机会", () => {
  const state = resolveExamAttemptCycle({
    attempts: failedAttempts,
    requiredCourseIds: ["video-1"],
    courseProgress: [{
      courseId: "video-1",
      completed: false,
      videoWatchCompleted: true,
      progress: 100,
      updatedAt: "2026-09-08T03:00:00.000Z"
    }]
  });

  assert.equal(state.cycle, 0);
  assert.equal(state.relearningRequired, true);
  assert.equal(state.unlockedByRelearning, false);
});

test("PPT重新阅读完成后仍需点击完成才恢复考试机会", () => {
  const state = resolveExamAttemptCycle({
    attempts: failedAttempts,
    requiredCourseIds: ["ppt-1"],
    courseProgress: [{
      courseId: "ppt-1",
      completed: false,
      readingCompleted: true,
      progress: 100,
      updatedAt: "2026-09-08T03:00:00.000Z"
    }]
  });

  assert.equal(state.cycle, 0);
  assert.equal(state.relearningRequired, true);
});

test("只有百分百进度但未点击完成的旧记录不能解锁", () => {
  const state = resolveExamAttemptCycle({
    attempts: failedAttempts,
    requiredCourseIds: ["legacy-course"],
    courseProgress: [{
      courseId: "legacy-course",
      completed: false,
      progress: 100,
      updatedAt: "2026-09-08T03:00:00.000Z"
    }]
  });

  assert.equal(state.cycle, 0);
  assert.equal(state.relearningRequired, true);
});

test("学习完成标记早于最近失败时不能解锁", () => {
  const state = resolveExamAttemptCycle({
    attempts: failedAttempts,
    requiredCourseIds: ["video-1"],
    courseProgress: [{
      courseId: "video-1",
      videoWatchCompleted: true,
      progress: 100,
      updatedAt: "2026-09-08T01:30:00.000Z"
    }]
  });

  assert.equal(state.cycle, 0);
  assert.equal(state.relearningRequired, true);
});

test("多项必修资料只重新完成一项时仍保持锁定", () => {
  const state = resolveExamAttemptCycle({
    attempts: failedAttempts,
    requiredCourseIds: ["video-1", "ppt-1"],
    courseProgress: [
      { courseId: "video-1", videoWatchCompleted: true, progress: 100, updatedAt: "2026-09-08T03:00:00.000Z" },
      { courseId: "ppt-1", readingCompleted: false, progress: 50, updatedAt: "2026-09-08T03:05:00.000Z" }
    ]
  });

  assert.equal(state.cycle, 0);
  assert.equal(state.relearningRequired, true);
});

test("必须完成全部课程且完成时间晚于最近失败，旧进度不能解锁", () => {
  const state = resolveExamAttemptCycle({
    attempts: failedAttempts,
    requiredCourseIds: ["video-1", "ppt-1"],
    courseProgress: [
      { courseId: "video-1", completed: true, updatedAt: "2026-09-08T01:30:00.000Z" },
      { courseId: "ppt-1", completed: true, updatedAt: "2026-09-08T03:05:00.000Z" }
    ]
  });

  assert.equal(state.cycle, 0);
  assert.equal(state.relearningRequired, true);
});

test("新周期第一次失败后只计算该周期次数并保留第二次机会", () => {
  const state = resolveExamAttemptCycle({
    attempts: [
      ...failedAttempts,
      { id: "a3", attemptCycle: 1, passed: false, createdAt: "2026-09-08T04:00:00.000Z" }
    ],
    requiredCourseIds: ["video-1"],
    courseProgress: [
      { courseId: "video-1", completed: false, updatedAt: "2026-09-08T04:00:01.000Z" }
    ]
  });

  assert.equal(state.cycle, 1);
  assert.equal(state.attemptsUsed, 1);
  assert.equal(state.attemptsRemaining, 1);
  assert.equal(state.relearningRequired, false);
});

test("完整流程：第一次失败可再考、第二次失败锁定、重学后恢复新一轮两次机会", () => {
  const requiredCourseIds = ["video-1", "ppt-1"];
  const beforeFailureProgress = [
    { courseId: "video-1", completed: true, updatedAt: "2026-09-08T00:40:00.000Z" },
    { courseId: "ppt-1", completed: true, updatedAt: "2026-09-08T00:45:00.000Z" }
  ];
  const firstFailure = [failedAttempts[0]];
  const afterFirst = resolveExamAttemptCycle({ attempts: firstFailure, requiredCourseIds, courseProgress: beforeFailureProgress });
  assert.deepEqual(
    { cycle: afterFirst.cycle, attemptsRemaining: afterFirst.attemptsRemaining, relearningRequired: afterFirst.relearningRequired },
    { cycle: 0, attemptsRemaining: 1, relearningRequired: false }
  );

  const afterSecond = resolveExamAttemptCycle({ attempts: failedAttempts, requiredCourseIds, courseProgress: beforeFailureProgress });
  assert.deepEqual(
    { cycle: afterSecond.cycle, attemptsRemaining: afterSecond.attemptsRemaining, relearningRequired: afterSecond.relearningRequired },
    { cycle: 0, attemptsRemaining: 0, relearningRequired: true }
  );

  const relearnedProgress = [
    { courseId: "video-1", completed: true, updatedAt: "2026-09-08T03:00:00.000Z" },
    { courseId: "ppt-1", completed: true, updatedAt: "2026-09-08T03:05:00.000Z" },
    { courseId: "other-product-video", completed: false, updatedAt: "2026-09-08T03:06:00.000Z" }
  ];
  const afterRelearning = resolveExamAttemptCycle({ attempts: failedAttempts, requiredCourseIds, courseProgress: relearnedProgress });
  assert.deepEqual(
    { cycle: afterRelearning.cycle, attemptsRemaining: afterRelearning.attemptsRemaining, relearningRequired: afterRelearning.relearningRequired },
    { cycle: 1, attemptsRemaining: 2, relearningRequired: false }
  );

  const newCycleFirstFailure = resolveExamAttemptCycle({
    attempts: [...failedAttempts, { id: "a3", attemptCycle: 1, passed: false, createdAt: "2026-09-08T04:00:00.000Z" }],
    requiredCourseIds,
    courseProgress: relearnedProgress
  });
  assert.deepEqual(
    { cycle: newCycleFirstFailure.cycle, attemptsRemaining: newCycleFirstFailure.attemptsRemaining, relearningRequired: newCycleFirstFailure.relearningRequired },
    { cycle: 1, attemptsRemaining: 1, relearningRequired: false }
  );
});

test("连续多轮未通过后都可通过重学恢复两次考试机会", () => {
  const requiredCourseIds = ["video-1", "ppt-1"];
  const attempts = [];
  const atMinute = (minute) => new Date(Date.UTC(2026, 8, 8, 0, minute)).toISOString();
  let courseProgress = [
    { courseId: "video-1", completed: true, updatedAt: atMinute(1) },
    { courseId: "ppt-1", completed: true, updatedAt: atMinute(2) }
  ];

  for (let cycle = 0; cycle < 5; cycle += 1) {
    const firstFailureMinute = 10 + cycle * 10;
    attempts.push({
      id: `cycle-${cycle}-attempt-1`,
      attemptCycle: cycle,
      passed: false,
      createdAt: atMinute(firstFailureMinute)
    });
    const afterFirstFailure = resolveExamAttemptCycle({ attempts, requiredCourseIds, courseProgress });
    assert.deepEqual(
      {
        cycle: afterFirstFailure.cycle,
        attemptsRemaining: afterFirstFailure.attemptsRemaining,
        relearningRequired: afterFirstFailure.relearningRequired
      },
      { cycle, attemptsRemaining: 1, relearningRequired: false }
    );

    attempts.push({
      id: `cycle-${cycle}-attempt-2`,
      attemptCycle: cycle,
      passed: false,
      createdAt: atMinute(firstFailureMinute + 1)
    });
    const afterSecondFailure = resolveExamAttemptCycle({ attempts, requiredCourseIds, courseProgress });
    assert.deepEqual(
      {
        cycle: afterSecondFailure.cycle,
        attemptsRemaining: afterSecondFailure.attemptsRemaining,
        relearningRequired: afterSecondFailure.relearningRequired
      },
      { cycle, attemptsRemaining: 0, relearningRequired: true }
    );

    courseProgress = [
      { courseId: "video-1", completed: true, updatedAt: atMinute(firstFailureMinute + 2) },
      { courseId: "ppt-1", completed: true, updatedAt: atMinute(firstFailureMinute + 3) }
    ];
    const afterRelearning = resolveExamAttemptCycle({ attempts, requiredCourseIds, courseProgress });
    assert.deepEqual(
      {
        cycle: afterRelearning.cycle,
        attemptsRemaining: afterRelearning.attemptsRemaining,
        relearningRequired: afterRelearning.relearningRequired,
        unlockedByRelearning: afterRelearning.unlockedByRelearning
      },
      { cycle: cycle + 1, attemptsRemaining: 2, relearningRequired: false, unlockedByRelearning: true }
    );
  }

  attempts.push({
    id: "cycle-5-passed",
    attemptCycle: 5,
    passed: true,
    score: 90,
    createdAt: atMinute(61)
  });
  const eventualPass = resolveExamAttemptCycle({ attempts, requiredCourseIds, courseProgress });
  assert.deepEqual(
    {
      cycle: eventualPass.cycle,
      attemptsUsed: eventualPass.attemptsUsed,
      attemptsRemaining: eventualPass.attemptsRemaining,
      relearningRequired: eventualPass.relearningRequired
    },
    { cycle: 5, attemptsUsed: 1, attemptsRemaining: 1, relearningRequired: false }
  );
});

test("90 分及以上通过时不进入重学锁定", () => {
  const state = resolveExamAttemptCycle({
    attempts: [{ id: "pass", attemptCycle: 0, passed: true, score: 90, createdAt: "2026-09-08T01:00:00.000Z" }],
    requiredCourseIds: ["video-1"],
    courseProgress: [{ courseId: "video-1", completed: true, updatedAt: "2026-09-08T00:50:00.000Z" }]
  });
  assert.equal(state.relearningRequired, false);
  assert.equal(state.attemptsRemaining, 1);
});

test("云函数写入考试周期，员工端不再提示联系总部", () => {
  const functionSource = fs.readFileSync(path.join(__dirname, "../cloudbase/functions/employeeWeb/index.js"), "utf8");
  const pageSource = fs.readFileSync(path.join(__dirname, "../apps/employee/src/pages/ExamPage.tsx"), "utf8");
  assert.match(functionSource, /attemptCycle/);
  assert.match(functionSource, /resolveExamAttemptCycle/);
  assert.match(functionSource, /getOptionalCollectionWhere\("examAttempts", \{ employeeId: employee\._id \}\)/);
  assert.match(functionSource, /getOptionalCollectionWhere\("courseProgress", \{ employeeId: employee\._id \}\)/);
  assert.doesNotMatch(functionSource, /本试卷两次考试机会已用完，请联系总部/);
  assert.match(pageSource, /完成后恢复两次考试机会/);
  assert.match(pageSource, /再考一次/);
  assert.match(pageSource, /clearNotice\(\)/);
  assert.match(pageSource, /refresh\(\{ fresh: true \}\)/);
  assert.doesNotMatch(pageSource, /本试卷考试机会已用完，请联系总部/);
});
