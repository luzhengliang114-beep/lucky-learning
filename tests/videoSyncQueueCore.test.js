const test = require("node:test");
const assert = require("node:assert/strict");

async function videoSyncQueueCore() {
  return import("../apps/employee/src/videoSyncQueueCore.js");
}

test("pending video progress keeps the latest maximum and ended state", async () => {
  const { upsertPendingVideoProgress } = await videoSyncQueueCore();
  const first = upsertPendingVideoProgress([], {
    id: "request-1",
    employeeId: "employee-1",
    courseId: "course-1",
    maxWatchedSeconds: 55,
    videoDurationSeconds: 60,
    ended: true,
    updatedAt: "2026-10-16T10:00:00.000Z"
  });
  const next = upsertPendingVideoProgress(first, {
    id: "request-2",
    employeeId: "employee-1",
    courseId: "course-1",
    maxWatchedSeconds: 54,
    videoDurationSeconds: 60,
    ended: false,
    updatedAt: "2026-10-16T10:00:01.000Z"
  });

  assert.equal(next.length, 1);
  assert.equal(next[0].id, "request-2");
  assert.equal(next[0].maxWatchedSeconds, 55);
  assert.equal(next[0].ended, true);
});

test("an older successful request cannot clear a newer pending report", async () => {
  const { removePendingVideoProgress } = await videoSyncQueueCore();
  const entries = [{
    id: "new-request",
    employeeId: "employee-1",
    courseId: "course-1",
    maxWatchedSeconds: 60,
    videoDurationSeconds: 60,
    ended: true,
    updatedAt: "2026-10-16T10:00:01.000Z"
  }];

  assert.equal(removePendingVideoProgress(entries, "old-request").length, 1);
  assert.equal(removePendingVideoProgress(entries, "new-request").length, 0);
});
