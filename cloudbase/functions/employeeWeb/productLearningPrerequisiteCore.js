const { learningProgressComplete } = require("./_shared/learningCompletion");

function text(value) {
  return String(value || "").trim();
}

function itemProductKey(item = {}) {
  return text(item.productId || item.productName || item.productKey || item.title);
}

function itemId(item = {}) {
  return text(item._id || item.id);
}

function evaluateProductLearningPrerequisite({
  employeeId = "",
  productKey = "",
  courses = [],
  phrases = [],
  progress = [],
  phraseAttempts = [],
  forceCourseLearning = false,
  requireAllLearning = false
} = {}) {
  const employee = text(employeeId);
  const product = text(productKey);
  const requiredCourses = (Array.isArray(courses) ? courses : []).filter((course) => (
    course.status === "published"
    && (course.track || "product") === "product"
    && itemProductKey(course) === product
  ));
  const requiredPhrases = (Array.isArray(phrases) ? phrases : []).filter((phrase) => (
    phrase.status === "published" && itemProductKey(phrase) === product
  ));
  const completedCourses = new Set((Array.isArray(progress) ? progress : [])
    .filter((item) => text(item.employeeId) === employee && learningProgressComplete(item))
    .map((item) => text(item.courseId)));
  const completedPhrases = new Set((Array.isArray(phraseAttempts) ? phraseAttempts : [])
    .filter((item) => text(item.employeeId) === employee && item.passed !== false)
    .map((item) => text(item.phraseId)));
  const missingCourses = requiredCourses.filter((course) => !completedCourses.has(itemId(course)));
  const requirePhrases = !forceCourseLearning || requireAllLearning;
  const missingPhrases = requirePhrases
    ? requiredPhrases.filter((phrase) => !completedPhrases.has(itemId(phrase)))
    : [];

  return {
    configured: requiredCourses.length > 0,
    requiredCourseCount: requiredCourses.length,
    requiredPhraseCount: requiredPhrases.length,
    missingCourseCount: missingCourses.length,
    missingPhraseCount: missingPhrases.length
  };
}

module.exports = { evaluateProductLearningPrerequisite };
