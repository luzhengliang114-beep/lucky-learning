function idValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (typeof value === "object") {
    if (typeof value.toHexString === "function") return value.toHexString().trim();
    if (typeof value.$oid === "string") return value.$oid.trim();
    if (typeof value.id === "string") return value.id.trim();
    if (typeof value._id === "string") return value._id.trim();
  }
  return String(value).trim();
}

function sameId(left, right) {
  const leftId = idValue(left);
  return Boolean(leftId) && leftId === idValue(right);
}

function progressForEmployee(records = [], employeeId) {
  return (Array.isArray(records) ? records : []).filter((record) => sameId(record?.employeeId, employeeId));
}

function maximum(left, right) {
  return Math.max(Number(left || 0), Number(right || 0));
}

function latestRecord(left, right) {
  const leftTime = Date.parse(String(left?.updatedAt || left?.completedAt || left?.createdAt || "")) || 0;
  const rightTime = Date.parse(String(right?.updatedAt || right?.completedAt || right?.createdAt || "")) || 0;
  return rightTime >= leftTime ? right : left;
}

function mergeCourseProgress(left, right) {
  const latest = latestRecord(left, right);
  return {
    ...left,
    ...right,
    ...latest,
    progress: maximum(left?.progress, right?.progress),
    maxWatchedSeconds: maximum(left?.maxWatchedSeconds, right?.maxWatchedSeconds),
    videoDurationSeconds: maximum(left?.videoDurationSeconds, right?.videoDurationSeconds),
    unlockedSlides: maximum(left?.unlockedSlides, right?.unlockedSlides),
    completed: left?.completed === true || right?.completed === true,
    videoWatchCompleted: left?.videoWatchCompleted === true || right?.videoWatchCompleted === true,
    readingCompleted: left?.readingCompleted === true || right?.readingCompleted === true
  };
}

function courseProgressByCourseId(records = []) {
  return (Array.isArray(records) ? records : []).reduce((progressByCourse, record) => {
    const courseId = idValue(record?.courseId);
    if (!courseId) return progressByCourse;
    const existing = progressByCourse.get(courseId);
    progressByCourse.set(courseId, existing ? mergeCourseProgress(existing, record) : record);
    return progressByCourse;
  }, new Map());
}

function courseLearningCompleted(progress = {}) {
  return progress?.completed === true
    || progress?.videoWatchCompleted === true
    || progress?.readingCompleted === true
    // Older records may persist the final percentage without the newer
    // boolean completion flags. Keep those records visible as completed.
    || Number(progress?.progress || 0) >= 100;
}

module.exports = {
  courseLearningCompleted,
  courseProgressByCourseId,
  idValue,
  mergeCourseProgress,
  progressForEmployee,
  sameId
};
