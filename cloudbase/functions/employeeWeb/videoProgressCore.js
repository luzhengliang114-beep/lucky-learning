const FIRST_SYNC_ALLOWANCE_SECONDS = 8;
const SYNC_GRACE_SECONDS = 3;
const COMPLETION_TOLERANCE_SECONDS = 3;
const MAX_VIDEO_SECONDS = 12 * 60 * 60;

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function seconds(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeVideoProgress(record) {
  return {
    ...(record || {}),
    maxWatchedSeconds: seconds(record?.maxWatchedSeconds),
    videoDurationSeconds: seconds(record?.videoDurationSeconds),
    videoWatchCompleted: Boolean(record?.videoWatchCompleted || record?.completed),
    videoLastSyncedAt: record?.videoLastSyncedAt || ""
  };
}

function updateVideoProgress(record, report, updatedAt, configuredDurationSeconds = 0) {
  const progress = normalizeVideoProgress(record);
  const reportedDuration = seconds(report?.videoDurationSeconds);
  if (reportedDuration <= 0 || reportedDuration > MAX_VIDEO_SECONDS) {
    fail("无法确认视频时长，请重新加载后再试", "VIDEO_DURATION_INVALID");
  }

  const configuredDuration = seconds(configuredDurationSeconds);
  const duration = configuredDuration || progress.videoDurationSeconds || reportedDuration;
  if (Math.abs(reportedDuration - duration) > Math.max(2, duration * 0.02)) {
    fail("视频时长发生变化，请刷新课程后重试", "VIDEO_DURATION_MISMATCH");
  }

  const reportedMaximum = Math.min(seconds(report?.maxWatchedSeconds), duration);
  const nextMaximum = Math.max(progress.maxWatchedSeconds, reportedMaximum);
  const lastSyncedMs = timestamp(progress.videoLastSyncedAt);
  const updatedMs = timestamp(updatedAt);
  const elapsedSeconds = lastSyncedMs && updatedMs > lastSyncedMs ? (updatedMs - lastSyncedMs) / 1000 : 0;
  const allowedAdvance = lastSyncedMs ? elapsedSeconds + SYNC_GRACE_SECONDS : FIRST_SYNC_ALLOWANCE_SECONDS;

  if (!progress.videoWatchCompleted && nextMaximum - progress.maxWatchedSeconds > allowedAdvance) {
    fail("检测到视频快进，请从当前学习位置继续播放", "VIDEO_FORWARD_SEEK_BLOCKED");
  }

  // Mobile WebViews do not reliably deliver the final `ended` event when the
  // user exits native fullscreen, locks the phone or immediately navigates
  // back. Normal-speed progress is already enforced above, so reaching the
  // final tolerance window is sufficient evidence of a complete watch.
  const reachedEnd = nextMaximum >= duration - COMPLETION_TOLERANCE_SECONDS;
  const videoWatchCompleted = progress.videoWatchCompleted || reachedEnd;
  return normalizeVideoProgress({
    ...progress,
    maxWatchedSeconds: videoWatchCompleted ? duration : nextMaximum,
    videoDurationSeconds: duration,
    videoWatchCompleted,
    videoLastSyncedAt: updatedAt
  });
}

function canCompleteVideo(progress) {
  const normalized = normalizeVideoProgress(progress);
  return normalized.videoWatchCompleted && normalized.videoDurationSeconds > 0;
}

module.exports = {
  canCompleteVideo,
  normalizeVideoProgress,
  updateVideoProgress
};
