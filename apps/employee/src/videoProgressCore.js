const SEEK_TOLERANCE_SECONDS = 0.05;
const PLAYBACK_EVENT_TOLERANCE_SECONDS = 0.75;

function finiteSeconds(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function normalizeVideoWatchProgress(progress) {
  return {
    maxWatchedSeconds: finiteSeconds(progress?.maxWatchedSeconds),
    videoDurationSeconds: finiteSeconds(progress?.videoDurationSeconds),
    videoWatchCompleted: Boolean(progress?.videoWatchCompleted || progress?.completed)
  };
}

export function allowedSeekTime({ targetSeconds, maxWatchedSeconds, completed, toleranceSeconds = SEEK_TOLERANCE_SECONDS }) {
  const target = finiteSeconds(targetSeconds);
  const maximum = finiteSeconds(maxWatchedSeconds);
  if (completed || target <= maximum + finiteSeconds(toleranceSeconds, SEEK_TOLERANCE_SECONDS)) return target;
  return maximum;
}

export function nextMaxWatchedSeconds({ currentSeconds, maxWatchedSeconds, completed, toleranceSeconds = PLAYBACK_EVENT_TOLERANCE_SECONDS, maxAdvanceSeconds = toleranceSeconds }) {
  const current = finiteSeconds(currentSeconds);
  const maximum = finiteSeconds(maxWatchedSeconds);
  if (completed) return Math.max(maximum, current);
  const allowance = Math.max(
    finiteSeconds(toleranceSeconds, PLAYBACK_EVENT_TOLERANCE_SECONDS),
    finiteSeconds(maxAdvanceSeconds, PLAYBACK_EVENT_TOLERANCE_SECONDS)
  );
  if (current > maximum + allowance) return maximum;
  return Math.max(maximum, current);
}

export function allowedPlaybackRate(requestedRate, completed) {
  const rate = Number(requestedRate);
  if (!completed) return 1;
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}
