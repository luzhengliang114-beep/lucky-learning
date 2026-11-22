export function courseIdValue(course) {
  return String(course?.id || course?._id || "").trim();
}

export function courseLearningCompleted(course, completedCourseIds = new Set()) {
  const courseId = courseIdValue(course);
  return Boolean(courseId && completedCourseIds.has(courseId))
    || course?.learningCompleted === true
    || course?.completed === true
    || course?.videoWatchCompleted === true
    || course?.readingCompleted === true
    || course?.videoProgress?.videoWatchCompleted === true
    || course?.pptProgress?.readingCompleted === true
    || Number(course?.progress || 0) >= 100;
}
