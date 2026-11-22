function text(value) {
  return String(value || "").trim();
}

function employeeId(employee) {
  return text(employee?.id || employee?._id);
}

function updateNotificationSummary(employee, caseId) {
  const required = Math.max(0, Number(employee?.notificationRequiredCount || 0));
  const acknowledged = Math.min(required, Math.max(0, Number(employee?.notificationAcknowledgedCount || 0)) + 1);
  return {
    ...employee,
    notificationAcknowledgedCount: acknowledged,
    notificationAcknowledgementRate: required ? Math.round(acknowledged / required * 100) : 0,
    notificationAcknowledgementHasData: required > 0,
    pendingNotifications: (employee?.pendingNotifications || []).filter((item) => text(item?.caseId) !== caseId)
  };
}

export function applyCaseAcknowledgement(data, caseIdValue, acknowledgedAtValue) {
  const caseId = text(caseIdValue);
  const acknowledgedAt = text(acknowledgedAtValue);
  const target = (data?.cases || []).find((item) => text(item?.id || item?._id) === caseId);
  if (!target || target.acknowledgementStatus === "acknowledged") return data;

  const currentEmployeeId = employeeId(data.employee);
  return {
    ...data,
    cases: data.cases.map((item) => text(item?.id || item?._id) === caseId ? {
      ...item,
      acknowledgementStatus: "acknowledged",
      acknowledgedAt,
      acknowledgementAcknowledgedCount: Math.min(
        Number(item.acknowledgementTargetCount || 0),
        Number(item.acknowledgementAcknowledgedCount || 0) + 1
      ),
      acknowledgementPendingCount: Math.max(0, Number(item.acknowledgementPendingCount || 0) - 1)
    } : item),
    employee: updateNotificationSummary(data.employee, caseId),
    ranking: (data.ranking || []).map((employee) => employeeId(employee) === currentEmployeeId
      ? updateNotificationSummary(employee, caseId)
      : employee)
  };
}

export function applyCourseReward(data, courseIdValue, result = {}) {
  const courseId = text(courseIdValue);
  const currentEmployeeId = employeeId(data.employee);
  const goldenBeans = Number.isFinite(Number(result?.goldenBeans))
    ? Number(result.goldenBeans)
    : Number(data.employee?.goldenBeans || 0) + Number(result?.award?.delta || 0);
  const completedCourse = (data.courses || []).find((course) => text(course?.id || course?._id) === courseId);
  const productName = text(completedCourse?.productName);
  const courses = (data.courses || []).map((course) => text(course?.id || course?._id) === courseId ? {
    ...course,
    completed: true,
    learningCompleted: true,
    progress: 100
  } : course);
  const productCourses = productName
    ? courses.filter((course) => text(course?.productName) === productName && text(course?.track || "product") === "product")
    : [];
  const productLearningCompleted = productCourses.length > 0
    && productCourses.every((course) => course?.completed === true);

  return {
    ...data,
    employee: { ...data.employee, goldenBeans },
    courses,
    exams: (data.exams || []).map((exam) => (
      productLearningCompleted
      && text(exam?.productName) === productName
      && exam?.learningResetRequired === true
        ? { ...exam, learningResetRequired: false, attemptCount: 0, attemptsRemaining: 2 }
        : exam
    )),
    ranking: (data.ranking || []).map((employee) => employeeId(employee) === currentEmployeeId
      ? { ...employee, goldenBeans }
      : employee)
  };
}

function updatedGoldenBeans(data, result = {}) {
  return Number.isFinite(Number(result?.goldenBeans))
    ? Number(result.goldenBeans)
    : Number(data.employee?.goldenBeans || 0) + Number(result?.award?.delta || 0);
}

function updateOwnGoldenBeans(data, goldenBeans) {
  const currentEmployeeId = employeeId(data.employee);
  return {
    employee: { ...data.employee, goldenBeans },
    ranking: (data.ranking || []).map((employee) => employeeId(employee) === currentEmployeeId
      ? { ...employee, goldenBeans }
      : employee)
  };
}

export function applyExamResult(data, examIdValue, result = {}) {
  const examId = text(examIdValue);
  const targetExam = (data.exams || []).find((exam) => text(exam?.id || exam?._id) === examId);
  if (!targetExam) return data;
  const passed = result?.passed === true;
  const relearningRequired = result?.relearningRequired === true;
  const goldenBeans = updatedGoldenBeans(data, result);
  const ownState = updateOwnGoldenBeans(data, goldenBeans);
  const productName = text(targetExam.productName);

  return {
    ...data,
    ...ownState,
    exams: (data.exams || []).map((exam) => text(exam?.id || exam?._id) === examId ? {
      ...exam,
      completed: passed || exam.completed === true,
      attemptCount: Number(result?.attemptsUsed ?? Number(exam.attemptCount || 0) + 1),
      attemptsRemaining: Number(result?.attemptsRemaining ?? exam.attemptsRemaining ?? 0),
      learningResetRequired: relearningRequired
    } : exam),
    courses: !relearningRequired ? data.courses : (data.courses || []).map((course) => (
      text(course.productName) === productName ? {
        ...course,
        completed: false,
        learningCompleted: false,
        progress: 0,
        videoProgress: course.videoProgress ? {
          ...course.videoProgress,
          maxWatchedSeconds: 0,
          videoWatchCompleted: false
        } : course.videoProgress,
        pptProgress: course.pptProgress ? {
          ...course.pptProgress,
          currentSlide: 0,
          unlockedSlides: 0,
          readingCompleted: false,
          progress: 0
        } : course.pptProgress
      } : course
    ))
  };
}

export function applyPhraseResult(data, phraseIdValue, result = {}) {
  const phraseId = text(phraseIdValue);
  const goldenBeans = updatedGoldenBeans(data, result);
  const ownState = updateOwnGoldenBeans(data, goldenBeans);
  return {
    ...data,
    ...ownState,
    phrases: (data.phrases || []).map((phrase) => text(phrase?.id || phrase?._id) === phraseId ? {
      ...phrase,
      completedCount: Number(result?.completedCount ?? phrase.completedCount ?? 0)
    } : phrase)
  };
}
