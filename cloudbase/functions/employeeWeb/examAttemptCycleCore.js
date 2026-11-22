const MAX_ATTEMPTS_PER_CYCLE = 2;

function text(value) {
  return String(value || "").trim();
}

function timestamp(value) {
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function cycleNumber(attempt = {}) {
  const value = Number(attempt.attemptCycle);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function chronologicalAttempts(attempts = []) {
  return (Array.isArray(attempts) ? attempts : [])
    .map((attempt, originalIndex) => ({ attempt, originalIndex }))
    .sort((left, right) => (
      timestamp(left.attempt.createdAt) - timestamp(right.attempt.createdAt)
      || left.originalIndex - right.originalIndex
    ))
    .map(({ attempt }) => attempt);
}

function completedRequiredLearningAfter({ requiredCourseIds = [], courseProgress = [], after = "" } = {}) {
  const required = [...new Set((Array.isArray(requiredCourseIds) ? requiredCourseIds : []).map(text).filter(Boolean))];
  if (!required.length) return false;
  const afterTime = timestamp(after);
  if (!afterTime) return false;
  const progressByCourse = new Map();
  (Array.isArray(courseProgress) ? courseProgress : []).forEach((progress) => {
    const courseId = text(progress.courseId);
    if (!courseId) return;
    const previous = progressByCourse.get(courseId);
    if (!previous || timestamp(progress.updatedAt || progress.completedAt) >= timestamp(previous.updatedAt || previous.completedAt)) {
      progressByCourse.set(courseId, progress);
    }
  });
  return required.every((courseId) => {
    const progress = progressByCourse.get(courseId);
    return progress?.completed === true && timestamp(progress.updatedAt || progress.completedAt) > afterTime;
  });
}

function resolveExamAttemptCycle({ attempts = [], requiredCourseIds = [], courseProgress = [] } = {}) {
  const ordered = chronologicalAttempts(attempts);
  const currentCycle = ordered.reduce((highest, attempt) => Math.max(highest, cycleNumber(attempt)), 0);
  const currentAttempts = ordered.filter((attempt) => cycleNumber(attempt) === currentCycle);
  const lastAttempt = currentAttempts[currentAttempts.length - 1] || null;
  const lastAttemptFailed = Boolean(lastAttempt && lastAttempt.passed === false);
  const attemptsUsed = currentAttempts.length;
  const attemptsExhausted = attemptsUsed >= MAX_ATTEMPTS_PER_CYCLE;
  const relearningNeeded = attemptsExhausted && lastAttemptFailed;
  const unlockedByRelearning = relearningNeeded && completedRequiredLearningAfter({
    requiredCourseIds,
    courseProgress,
    after: lastAttempt.createdAt
  });

  if (unlockedByRelearning) {
    return {
      cycle: currentCycle + 1,
      attemptsUsed: 0,
      attemptsRemaining: MAX_ATTEMPTS_PER_CYCLE,
      relearningRequired: false,
      unlockedByRelearning: true
    };
  }

  return {
    cycle: currentCycle,
    attemptsUsed,
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS_PER_CYCLE - attemptsUsed),
    relearningRequired: relearningNeeded,
    unlockedByRelearning: false
  };
}

module.exports = {
  MAX_ATTEMPTS_PER_CYCLE,
  completedRequiredLearningAfter,
  resolveExamAttemptCycle
};
