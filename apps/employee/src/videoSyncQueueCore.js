function text(value) {
  return String(value || "").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function identity(entry = {}) {
  return `${text(entry.employeeId)}:${text(entry.courseId)}`;
}

export function normalizePendingVideoProgress(entry = {}) {
  return {
    id: text(entry.id),
    employeeId: text(entry.employeeId),
    courseId: text(entry.courseId),
    maxWatchedSeconds: number(entry.maxWatchedSeconds),
    videoDurationSeconds: number(entry.videoDurationSeconds),
    ended: entry.ended === true,
    updatedAt: text(entry.updatedAt)
  };
}

export function upsertPendingVideoProgress(entries = [], entry = {}) {
  const next = normalizePendingVideoProgress(entry);
  if (!next.id || !next.employeeId || !next.courseId || next.videoDurationSeconds <= 0) {
    return (Array.isArray(entries) ? entries : []).map(normalizePendingVideoProgress);
  }
  const list = (Array.isArray(entries) ? entries : []).map(normalizePendingVideoProgress);
  const previous = list.find((item) => identity(item) === identity(next));
  const merged = previous ? {
    ...next,
    maxWatchedSeconds: Math.max(previous.maxWatchedSeconds, next.maxWatchedSeconds),
    videoDurationSeconds: next.videoDurationSeconds || previous.videoDurationSeconds,
    ended: previous.ended || next.ended
  } : next;
  return [...list.filter((item) => identity(item) !== identity(next)), merged];
}

export function removePendingVideoProgress(entries = [], requestId = "") {
  const id = text(requestId);
  return (Array.isArray(entries) ? entries : [])
    .map(normalizePendingVideoProgress)
    .filter((entry) => entry.id !== id);
}
