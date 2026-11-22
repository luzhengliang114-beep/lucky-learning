const { createHash } = require("node:crypto");
const { taskCompletedForProduct } = require("./learningMetrics");
const { learningProgressComplete } = require("./learningCompletion");

function text(value) {
  return String(value || "").trim();
}

function idOf(value = {}) {
  return text(value.id || value._id);
}

function productOf(value = {}) {
  return text(value.productKey || value.productId || value.productName || value.chronicCategory || "其他资料");
}

function published(value = {}) {
  return value.status === "published";
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function progressComplete(progress = {}) {
  return learningProgressComplete(progress);
}

function coursePercent(course = {}, progress = {}) {
  if (progressComplete(progress)) return 100;
  const explicit = Number(progress.progress);
  if (Number.isFinite(explicit)) return clampPercent(explicit);
  const slideCount = Math.max(0, Number(course.slideCount || 0));
  if (course.resourceType === "ppt" && slideCount > 0) {
    return clampPercent(Number(progress.unlockedSlides || 0) / slideCount * 100);
  }
  const duration = Number(progress.videoDurationSeconds || course.videoDurationSeconds || 0);
  const watched = Number(progress.maxWatchedSeconds || 0);
  return duration > 0 ? clampPercent(watched / duration * 100) : 0;
}

function phraseLimit(phrase = {}) {
  const value = Number(phrase.maxRewardedAttempts || 1);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function phraseCompletedCount(phrase, attempts = [], ledger = []) {
  const phraseId = idOf(phrase);
  const recorded = attempts.filter((attempt) => (
    text(attempt.phraseId) === phraseId
    && attempt.passed !== false
    && attempt.counted !== false
  )).length;
  const legacy = ledger.filter((entry) => (
    Number(entry.delta || 0) > 0
    && (text(entry.sourceId) === phraseId || text(entry.sourceId).startsWith(`${phraseId}-`))
  )).length;
  return Math.min(phraseLimit(phrase), Math.max(recorded, legacy));
}

function examPassed(exam, attempts = []) {
  const examId = idOf(exam);
  return attempts.some((attempt) => (
    text(attempt.examId) === examId
    && attempt.passed !== false
    && Number(attempt.score || 0) >= 90
  ));
}

function attemptCycle(exam, attempts = [], courses = [], progressByCourse) {
  const examId = idOf(exam);
  const ordered = attempts
    .filter((attempt) => text(attempt.examId) === examId)
    .slice()
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
  const currentCycle = ordered.reduce((max, attempt) => Math.max(max, Number.isInteger(Number(attempt.attemptCycle)) ? Number(attempt.attemptCycle) : 0), 0);
  const current = ordered.filter((attempt) => (Number.isInteger(Number(attempt.attemptCycle)) ? Number(attempt.attemptCycle) : 0) === currentCycle);
  const last = current[current.length - 1];
  const lastFailed = Boolean(last && last.passed === false);
  const relearningNeeded = current.length >= 2 && lastFailed;
  const productCourses = courses.filter((course) => productOf(course) === productOf(exam));
  const relearningComplete = relearningNeeded && productCourses.length > 0 && productCourses.every((course) => {
    const progress = progressByCourse.get(idOf(course));
    const updatedAt = Date.parse(String(progress?.updatedAt || progress?.completedAt || "")) || 0;
    const failedAt = Date.parse(String(last.createdAt || "")) || 0;
    return progress?.completed === true && updatedAt > failedAt;
  });
  return {
    attemptsUsed: relearningComplete ? 0 : current.length,
    attemptsRemaining: relearningComplete ? 2 : Math.max(0, 2 - current.length),
    relearningRequired: relearningNeeded && !relearningComplete
  };
}

function todoItem({ id, type, productKey, productName, title, progress = 0, status, route, locked = false, sourceId }) {
  return { id, type, productKey, productName, title, progress: clampPercent(progress), status, route, locked, sourceId };
}

function buildLearningTodos({
  employeeId,
  courses = [],
  courseProgress = [],
  phrases = [],
  phrasePracticeAttempts = [],
  goldenBeanLedger = [],
  exams = [],
  examAttempts = [],
  employeeProductTasks = [],
  productTaskPeriodKey = "",
  supplier = false
} = {}) {
  if (!employeeId || supplier) return { count: 0, groups: [], todos: [], summaryHash: summaryHash([]) };

  const employeeKey = text(employeeId);
  const employeeProgress = courseProgress.filter((item) => text(item.employeeId) === employeeKey);
  const progressByCourse = new Map();
  employeeProgress.forEach((item) => {
    const courseId = idOf(item.courseId ? { id: item.courseId } : item);
    if (!courseId) return;
    const existing = progressByCourse.get(courseId);
    const existingTime = Date.parse(String(existing?.updatedAt || existing?.completedAt || "")) || 0;
    const currentTime = Date.parse(String(item.updatedAt || item.completedAt || "")) || 0;
    if (!existing || currentTime >= existingTime) progressByCourse.set(courseId, item);
  });
  const attempts = examAttempts.filter((item) => text(item.employeeId) === employeeKey);
  const phraseAttempts = phrasePracticeAttempts.filter((item) => text(item.employeeId) === employeeKey);
  const employeeLedger = goldenBeanLedger.filter((item) => text(item.employeeId) === employeeKey);
  const publishedCourses = courses.filter(published);
  const publishedPhrases = phrases.filter(published);
  const publishedExams = exams.filter(published);
  const relearningProductKeys = new Set(publishedExams
    .filter((exam) => attemptCycle(exam, attempts, publishedCourses, progressByCourse).relearningRequired)
    .map(productOf));
  const todos = [];
  const productTaskCompleted = (item) => taskCompletedForProduct({
    employeeId: employeeKey,
    product: item,
    employeeProductTasks,
    periodKey: productTaskPeriodKey
  });

  publishedCourses.forEach((course) => {
    if (productTaskCompleted(course)) return;
    const courseId = idOf(course);
    if (!courseId) return;
    const progress = progressByCourse.get(courseId) || {};
    const relearningRequiresConfirmation = relearningProductKeys.has(productOf(course));
    if (relearningRequiresConfirmation ? progress.completed === true : progressComplete(progress)) return;
    const isPpt = course.resourceType === "ppt" && Number(course.slideCount || 0) > 0;
    const watchedButUnconfirmed = relearningRequiresConfirmation && progressComplete(progress);
    todos.push(todoItem({
      id: `course:${courseId}`,
      type: isPpt ? "material" : "video",
      productKey: productOf(course),
      productName: productOf(course),
      title: text(course.title) || "未命名资料",
      progress: coursePercent(course, progress),
      status: watchedButUnconfirmed ? "已学习，请点击完成" : isPpt ? "资料未完成" : "视频未完成",
      route: "learning",
      sourceId: courseId
    }));
  });

  publishedPhrases.forEach((phrase) => {
    if (productTaskCompleted(phrase)) return;
    const completed = phraseCompletedCount(phrase, phraseAttempts, employeeLedger);
    const limit = phraseLimit(phrase);
    if (completed >= limit) return;
    todos.push(todoItem({
      id: `phrase:${idOf(phrase)}`,
      type: "audio",
      productKey: productOf(phrase),
      productName: productOf(phrase),
      title: text(phrase.title) || "未命名话术",
      progress: completed / limit * 100,
      status: completed ? `已完成 ${completed}/${limit} 次` : "尚未开始",
      route: "phrases",
      sourceId: idOf(phrase)
    }));
  });

  publishedExams.forEach((exam) => {
    if (productTaskCompleted(exam)) return;
    if (examPassed(exam, attempts)) return;
    const cycle = attemptCycle(exam, attempts, publishedCourses, progressByCourse);
    const status = cycle.relearningRequired
      ? "重新学习并逐项点击完成后开放"
      : cycle.attemptsUsed
        ? `剩余 ${cycle.attemptsRemaining} 次机会`
        : "尚未参加";
    todos.push(todoItem({
      id: `exam:${idOf(exam)}`,
      type: "exam",
      productKey: productOf(exam),
      productName: productOf(exam),
      title: text(exam.title) || "产品测评",
      progress: 0,
      status,
      route: "exam",
      locked: cycle.relearningRequired,
      sourceId: idOf(exam)
    }));
  });

  todos.sort((left, right) => (
    left.productName.localeCompare(right.productName, "zh-Hans-CN")
    || left.type.localeCompare(right.type)
    || left.title.localeCompare(right.title, "zh-Hans-CN")
  ));
  const groupsByProduct = new Map();
  todos.forEach((item) => {
    const group = groupsByProduct.get(item.productKey) || { productKey: item.productKey, productName: item.productName, count: 0, items: [] };
    group.items.push(item);
    group.count = group.items.length;
    groupsByProduct.set(item.productKey, group);
  });
  const groups = [...groupsByProduct.values()];
  return { count: todos.length, groups, todos, summaryHash: summaryHash(todos) };
}

function summaryHash(todos = []) {
  const normalized = todos.map((item) => ({ id: item.id, type: item.type, productKey: item.productKey, progress: item.progress, status: item.status, locked: item.locked }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

module.exports = {
  buildLearningTodos,
  coursePercent,
  progressComplete,
  summaryHash
};
