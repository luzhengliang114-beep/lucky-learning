const test = require("node:test");
const assert = require("node:assert/strict");

const {
  canCompleteVideo,
  normalizeVideoProgress,
  updateVideoProgress
} = require("../cloudbase/functions/employeeWeb/videoProgressCore");

test("server accepts watched progress at normal elapsed speed", () => {
  const first = updateVideoProgress(null, {
    maxWatchedSeconds: 5,
    videoDurationSeconds: 60
  }, "2026-08-14T10:00:05.000Z");
  const second = updateVideoProgress(first, {
    maxWatchedSeconds: 10,
    videoDurationSeconds: 60
  }, "2026-08-14T10:00:10.000Z");

  assert.equal(second.maxWatchedSeconds, 10);
  assert.equal(second.videoWatchCompleted, false);
});

test("server rejects a forward jump beyond elapsed time", () => {
  const progress = normalizeVideoProgress({
    maxWatchedSeconds: 10,
    videoDurationSeconds: 60,
    videoLastSyncedAt: "2026-08-14T10:00:10.000Z"
  });

  assert.throws(
    () => updateVideoProgress(progress, {
      maxWatchedSeconds: 40,
      videoDurationSeconds: 60
    }, "2026-08-14T10:00:15.000Z"),
    (error) => error.code === "VIDEO_FORWARD_SEEK_BLOCKED"
  );
});

test("server marks completion near the end even when a mobile WebView drops ended", () => {
  const nearEnd = normalizeVideoProgress({
    maxWatchedSeconds: 55,
    videoDurationSeconds: 60,
    videoLastSyncedAt: "2026-08-14T10:00:55.000Z"
  });
  const withoutEnded = updateVideoProgress(nearEnd, {
    maxWatchedSeconds: 58,
    videoDurationSeconds: 60
  }, "2026-08-14T10:01:00.000Z");

  assert.equal(canCompleteVideo(withoutEnded), true);
  assert.equal(withoutEnded.videoWatchCompleted, true);
  assert.equal(withoutEnded.maxWatchedSeconds, 60);
});

test("server does not complete a video outside the final tolerance window", () => {
  const progress = normalizeVideoProgress({
    maxWatchedSeconds: 50,
    videoDurationSeconds: 60,
    videoLastSyncedAt: "2026-08-14T10:00:50.000Z"
  });
  const next = updateVideoProgress(progress, {
    maxWatchedSeconds: 56.9,
    videoDurationSeconds: 60,
    ended: true
  }, "2026-08-14T10:00:57.000Z");

  assert.equal(canCompleteVideo(next), false);
  assert.equal(next.videoWatchCompleted, false);
});

test("existing completed courses remain unlocked after migration", () => {
  const progress = normalizeVideoProgress({ completed: true, progress: 100 });

  assert.equal(progress.videoWatchCompleted, true);
});
