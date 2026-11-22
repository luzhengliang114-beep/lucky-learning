import { courseIdValue, courseLearningCompleted } from "./courseCompletionCore.js";

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

export function courseProgressPercent(course = {}, completedCourseIds = new Set()) {
  if (courseLearningCompleted(course, completedCourseIds)) return 100;
  const explicit = Number(course.progress);
  const hasExplicit = course.progress !== undefined && course.progress !== null && Number.isFinite(explicit);
  const pptProgress = course.pptProgress || {};
  const slideCount = Math.max(0, Number(course.slideCount || pptProgress.slideCount || 0));
  if ((course.resourceType === "ppt" || course.resourceType === "pptx") && slideCount > 0) {
    return Math.max(hasExplicit ? clampPercent(explicit) : 0, clampPercent(Number(pptProgress.unlockedSlides || 0) / slideCount * 100));
  }
  const videoProgress = course.videoProgress || {};
  const duration = Number(videoProgress.videoDurationSeconds || course.videoDurationSeconds || 0);
  const watched = Number(videoProgress.maxWatchedSeconds || 0);
  const mediaPercent = duration > 0 ? clampPercent(watched / duration * 100) : 0;
  return Math.max(hasExplicit ? clampPercent(explicit) : 0, mediaPercent);
}

function phraseCompletionCount(phrase, submissions = []) {
  const limit = Math.max(1, Math.trunc(Number(phrase.maxRewardedAttempts || 1)));
  const stored = Number(phrase.completedCount);
  const recorded = Number.isFinite(stored)
    ? stored
    : submissions.filter((item) => item.type === "phrase" && item.phraseId === courseIdValue(phrase) && item.status === "approved").length;
  return Math.min(limit, Math.max(0, Math.trunc(recorded)));
}

function phraseCount(phrase) {
  return Math.max(1, Math.trunc(Number(phrase.maxRewardedAttempts || 1)));
}

function taskIsComplete(item, taskStatuses) {
  if ((item.track || "product") !== "product") return false;
  const productKey = String(item.productName || item.productKey || item.productId || "").trim();
  return Boolean(productKey && taskStatuses.some((task) => (
    task.status === "completed" && String(task.productKey || "").trim() === productKey
  )));
}

export function learningProgressSummary(data = {}, { includeSpeaking = true } = {}) {
  const courses = Array.isArray(data.courses) ? data.courses : [];
  const phrases = includeSpeaking && Array.isArray(data.phrases) ? data.phrases : [];
  const exams = Array.isArray(data.exams) ? data.exams : [];
  const submissions = Array.isArray(data.submissions) ? data.submissions : [];
  const taskStatuses = Array.isArray(data.productTaskStatuses) ? data.productTaskStatuses : [];
  const completedCourseIds = data.completedCourseIds || new Set();
  const failedProducts = new Set(exams.filter((exam) => exam.learningResetRequired === true).map((exam) => (
    String(exam.productName || exam.productKey || exam.productId || "").trim()
  )).filter(Boolean));
  const values = [];
  courses.forEach((course) => {
    const product = String(course.productName || course.productKey || course.productId || "").trim();
    values.push(taskIsComplete(course, taskStatuses) && !failedProducts.has(product)
      ? 100
      : courseProgressPercent(course, completedCourseIds));
  });
  phrases.forEach((phrase) => {
    const count = phraseCount(phrase);
    const product = String(phrase.productName || phrase.productKey || phrase.productId || "").trim();
    const done = taskIsComplete(phrase, taskStatuses) && !failedProducts.has(product)
      ? count
      : phraseCompletionCount(phrase, submissions);
    for (let index = 0; index < count; index += 1) values.push(index < done ? 100 : 0);
  });
  exams.forEach((exam) => {
    const product = String(exam.productName || exam.productKey || exam.productId || "").trim();
    values.push(taskIsComplete(exam, taskStatuses) && !failedProducts.has(product) || exam.completed === true ? 100 : 0);
  });
  const total = values.length;
  const completed = values.filter((value) => value >= 100).length;
  const percent = total ? Math.round(values.reduce((sum, value) => sum + value, 0) / total) : 0;
  return { completed, total, percent };
}

export function learningTodoGroups(data = {}, { includeSpeaking = true } = {}) {
  if (data.isSupplier) return [];
  const courses = Array.isArray(data.courses) ? data.courses : [];
  const phrases = includeSpeaking && Array.isArray(data.phrases) ? data.phrases : [];
  const exams = Array.isArray(data.exams) ? data.exams : [];
  const submissions = Array.isArray(data.submissions) ? data.submissions : [];
  const taskStatuses = Array.isArray(data.productTaskStatuses) ? data.productTaskStatuses : [];
  const completedCourseIds = data.completedCourseIds || new Set();
  const failedProducts = new Set(exams.filter((exam) => exam.learningResetRequired === true).map((exam) => (
    String(exam.productName || exam.productKey || exam.productId || "").trim()
  )).filter(Boolean));
  const todos = [];

  courses.forEach((course) => {
    const courseId = courseIdValue(course);
    if (!courseId || course.status && course.status !== "published") return;
    const productName = String(course.productName || course.chronicCategory || "其他资料").trim();
    if (courseLearningCompleted(course, completedCourseIds)) return;
    if (taskIsComplete(course, taskStatuses) && !failedProducts.has(productName)) return;
    const isPpt = course.resourceType === "ppt" || course.resourceType === "pptx";
    todos.push({ id: `course:${courseId}`, type: isPpt ? "material" : "video", productKey: productName, productName, title: course.title || "未命名资料", progress: courseProgressPercent(course, completedCourseIds), status: isPpt ? "资料未完成" : "视频未完成", route: "learning" });
  });
  phrases.forEach((phrase) => {
    if (phrase.status && phrase.status !== "published") return;
    const limit = phraseCount(phrase);
    const productName = String(phrase.productName || phrase.productKey || "其他资料").trim();
    const completed = phraseCompletionCount(phrase, submissions);
    if (completed >= limit || taskIsComplete(phrase, taskStatuses) && !failedProducts.has(productName)) return;
    todos.push({ id: `phrase:${courseIdValue(phrase)}`, type: "audio", productKey: productName, productName, title: phrase.title || "未命名话术", progress: Math.round(completed / limit * 100), status: completed ? `已完成 ${completed}/${limit} 次` : "尚未开始", route: "phrases" });
  });
  exams.forEach((exam) => {
    if (exam.status && exam.status !== "published") return;
    const productName = String(exam.productName || exam.productKey || "其他资料").trim();
    if (exam.completed === true || taskIsComplete(exam, taskStatuses) && !failedProducts.has(productName)) return;
    todos.push({ id: `exam:${courseIdValue(exam)}`, type: "exam", productKey: productName, productName, title: exam.title || "产品测评", progress: 0, status: exam.learningResetRequired ? "重新完成视频/PPT后开放" : "尚未参加", route: "exam", locked: exam.learningResetRequired === true });
  });

  todos.sort((left, right) => left.productName.localeCompare(right.productName, "zh-Hans-CN") || left.type.localeCompare(right.type) || left.title.localeCompare(right.title, "zh-Hans-CN"));
  const groups = new Map();
  todos.forEach((item) => {
    const group = groups.get(item.productKey) || { productKey: item.productKey, productName: item.productName, count: 0, items: [] };
    group.items.push(item);
    group.count = group.items.length;
    groups.set(item.productKey, group);
  });
  return [...groups.values()];
}
