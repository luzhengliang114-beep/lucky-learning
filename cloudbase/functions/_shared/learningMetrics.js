function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

function averagePercent(values = []) {
  const numeric = values.map(clampPercent);
  if (!numeric.length) return 0;
  return Math.round(numeric.reduce((sum, value) => sum + value, 0) / numeric.length);
}

function courseProgressPercent(course = {}, progress = {}) {
  if (progress?.completed === true || progress?.videoWatchCompleted === true || progress?.readingCompleted === true) {
    return 100;
  }
  const explicitProgress = Number(progress?.progress);
  if (Number.isFinite(explicitProgress)) return clampPercent(explicitProgress);

  const slideCount = Math.max(0, Number(course.slideCount || 0));
  if (course.resourceType === "ppt" && slideCount > 0) {
    return clampPercent(Number(progress?.unlockedSlides || 0) / slideCount * 100);
  }

  const duration = Number(progress?.videoDurationSeconds || course.videoDurationSeconds || 0);
  const watched = Number(progress?.maxWatchedSeconds || 0);
  return duration > 0 ? clampPercent(watched / duration * 100) : 0;
}

function phraseCompletedCount({ phrase = {}, attempts = [], ledger = [] } = {}) {
  const phraseId = String(phrase.id || phrase._id || "");
  const limit = Math.max(1, Math.trunc(Number(phrase.maxRewardedAttempts || 1)));
  const recorded = attempts.filter((attempt) => (
    String(attempt.phraseId || "") === phraseId
    && attempt.passed !== false
    && attempt.counted !== false
  )).length;
  const legacy = ledger.filter((entry) => (
    Number(entry.delta || 0) > 0
    && (String(entry.sourceId || "") === phraseId || String(entry.sourceId || "").startsWith(`${phraseId}-`))
  )).length;
  return Math.min(limit, Math.max(recorded, legacy));
}

function examPassed({ exam = {}, attempts = [] } = {}) {
  const examId = String(exam.id || exam._id || "");
  return attempts.some((attempt) => (
    String(attempt.examId || "") === examId
    && attempt.passed !== false
    && Number(attempt.score || 0) >= 90
  ));
}

function taskCompletedForProduct({ employeeId, product, employeeProductTasks = [], periodKey } = {}) {
  const employeeKey = String(employeeId || "");
  const productKey = String(product?.productKey || product?.productId || product?.productName || "").trim();
  if (!employeeKey || !productKey) return false;
  return employeeProductTasks.some((task) => (
    String(task.employeeId || "") === employeeKey
    && String(task.productKey || task.productId || task.productName || "").trim() === productKey
    && (!periodKey || String(task.periodKey || "").trim() === String(periodKey).trim())
    && Number(task.targetQuantity || 0) > 0
    && Number(task.completedQuantity || 0) >= Number(task.targetQuantity || 0)
  ));
}

function learningMetricsForEmployee({
  employeeId,
  courses = [],
  courseProgress = [],
  phrases = [],
  phrasePracticeAttempts = [],
  goldenBeanLedger = [],
  exams = [],
  examAttempts = [],
  employeeProductTasks = [],
  productTaskPeriodKey = ""
} = {}) {
  const employeeKey = String(employeeId || "");
  const publishedCourses = courses.filter((course) => course?.status === "published");
  const publishedPhrases = phrases.filter((phrase) => phrase?.status === "published");
  const publishedExams = exams.filter((exam) => exam?.status === "published");

  const courseValues = publishedCourses.map((course) => {
    if (taskCompletedForProduct({ employeeId, product: course, employeeProductTasks, periodKey: productTaskPeriodKey })) return 100;
    const courseId = String(course.id || course._id || "");
    const progress = courseProgress.find((item) => (
      String(item.employeeId || "") === employeeKey
      && String(item.courseId || "") === courseId
    ));
    return courseProgressPercent(course, progress);
  });

  const phraseValues = [];
  for (const phrase of publishedPhrases) {
    if (taskCompletedForProduct({ employeeId, product: phrase, employeeProductTasks, periodKey: productTaskPeriodKey })) {
      const limit = Math.max(1, Math.trunc(Number(phrase.maxRewardedAttempts || 1)));
      for (let index = 0; index < limit; index += 1) phraseValues.push(100);
      continue;
    }
    const limit = Math.max(1, Math.trunc(Number(phrase.maxRewardedAttempts || 1)));
    const completed = phraseCompletedCount({
      phrase,
      attempts: phrasePracticeAttempts.filter((item) => String(item.employeeId || "") === employeeKey),
      ledger: goldenBeanLedger.filter((item) => String(item.employeeId || "") === employeeKey)
    });
    for (let index = 0; index < limit; index += 1) phraseValues.push(index < completed ? 100 : 0);
  }

  const examValues = publishedExams.map((exam) => (
    taskCompletedForProduct({ employeeId, product: exam, employeeProductTasks, periodKey: productTaskPeriodKey }) || examPassed({
      exam,
      attempts: examAttempts.filter((item) => String(item.employeeId || "") === employeeKey)
    }) ? 100 : 0
  ));

  return {
    courseCompletionRate: averagePercent([...courseValues, ...phraseValues, ...examValues]),
    contentCompletionRate: averagePercent([...courseValues, ...phraseValues]),
    examPassRate: averagePercent(examValues),
    unitCount: courseValues.length + phraseValues.length + examValues.length,
    completedUnitCount: [...courseValues, ...phraseValues, ...examValues].filter((value) => value >= 100).length,
    courseUnitCount: courseValues.length,
    phraseUnitCount: phraseValues.length,
    examUnitCount: examValues.length
  };
}

function productKey(item = {}) {
  return String(item.productKey || item.productId || item.productName || "").trim();
}

function learningProductDetails(options = {}) {
  const courses = (options.courses || []).filter((item) => item?.status === "published");
  const phrases = (options.phrases || []).filter((item) => item?.status === "published");
  const exams = (options.exams || []).filter((item) => item?.status === "published");
  const keys = [...new Set([...courses, ...phrases, ...exams].map(productKey).filter(Boolean))];
  return keys.map((key) => {
    const metrics = learningMetricsForEmployee({
      ...options,
      courses: courses.filter((item) => productKey(item) === key),
      phrases: phrases.filter((item) => productKey(item) === key),
      exams: exams.filter((item) => productKey(item) === key)
    });
    return {
      productKey: key,
      productName: key,
      completedUnitCount: metrics.completedUnitCount,
      unitCount: metrics.unitCount,
      completionRate: metrics.courseCompletionRate
    };
  }).sort((left, right) => left.productName.localeCompare(right.productName, "zh-CN"));
}

module.exports = {
  averagePercent,
  clampPercent,
  courseProgressPercent,
  examPassed,
  learningProductDetails,
  learningMetricsForEmployee,
  phraseCompletedCount,
  taskCompletedForProduct
};
