function text(value) {
  return String(value || "").trim();
}

function id(value = {}) {
  return text(value.id || value._id);
}

function percent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function latest(records = []) {
  return [...records].sort((left, right) => (
    String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || ""))
  ))[0];
}

function platform(record = {}) {
  return text(record.clientContext?.platform || "unknown");
}

export function buildEmployeeLearningAudit({
  employeeId = "",
  courses = [],
  courseProgress = [],
  exams = [],
  examAttempts = [],
  phrases = [],
  phrasePracticeAttempts = []
} = {}) {
  const employeeKey = text(employeeId);
  const employeeCourseProgress = courseProgress.filter((record) => text(record.employeeId) === employeeKey);
  const employeeExamAttempts = examAttempts.filter((record) => text(record.employeeId) === employeeKey);
  const employeePhraseAttempts = phrasePracticeAttempts.filter((record) => text(record.employeeId) === employeeKey);

  const courseRows = courses
    .filter((course) => course.status === "published")
    .map((course) => {
      const record = latest(employeeCourseProgress.filter((item) => text(item.courseId) === id(course)));
      const progress = record ? percent(record.progress || (
        Number(record.videoDurationSeconds || 0) > 0
          ? Number(record.maxWatchedSeconds || 0) / Number(record.videoDurationSeconds) * 100
          : 0
      )) : 0;
      const completed = Boolean(record && (
        record.completed === true
        || record.videoWatchCompleted === true
        || record.readingCompleted === true
        || progress >= 100
      ));
      return {
        id: id(course),
        productName: text(course.productName || course.chronicCategory || "其他"),
        title: text(course.title),
        status: completed ? "completed" : record && progress > 0 ? "in-progress" : "not-started",
        progress: completed ? 100 : Math.round(progress),
        lastActivityAt: text(record?.updatedAt),
        platform: platform(record)
      };
    });

  const examRows = exams
    .filter((exam) => exam.status === "published")
    .map((exam) => {
      const attempts = employeeExamAttempts.filter((item) => text(item.examId) === id(exam));
      const latestAttempt = latest(attempts);
      const passedAttempt = attempts.find((item) => item.passed === true);
      return {
        id: id(exam),
        productName: text(exam.productName || "综合知识"),
        title: text(exam.title),
        status: passedAttempt ? "passed" : attempts.length ? "failed" : "not-started",
        score: Number((passedAttempt || latestAttempt)?.score || 0),
        attemptCount: attempts.length,
        lastActivityAt: text(latestAttempt?.createdAt),
        platform: platform(latestAttempt)
      };
    });

  const phraseRows = phrases
    .filter((phrase) => phrase.status === "published")
    .map((phrase) => {
      const attempts = employeePhraseAttempts.filter((item) => text(item.phraseId) === id(phrase));
      const passedCount = attempts.filter((item) => item.passed === true && item.counted !== false).length;
      const requiredCount = Math.max(1, Number(phrase.maxRewardedAttempts || 1));
      const latestAttempt = latest(attempts);
      return {
        id: id(phrase),
        productName: text(phrase.productName || "通用话术"),
        title: text(phrase.title),
        status: passedCount >= requiredCount ? "completed" : attempts.length ? "in-progress" : "not-started",
        completedCount: Math.min(requiredCount, passedCount),
        requiredCount,
        lastActivityAt: text(latestAttempt?.createdAt),
        platform: platform(latestAttempt)
      };
    });

  return {
    hasActivity: employeeCourseProgress.length > 0 || employeeExamAttempts.length > 0 || employeePhraseAttempts.length > 0,
    courseRows,
    examRows,
    phraseRows
  };
}
