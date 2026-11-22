const DEMO_SCHEMA_VERSION = 4;
const PRODUCT_REWARD_CAPS = {};
const CASE_PRIVACY_VERSION = "case-deidentification-2026-07-30";
const MAX_EXAM_ATTEMPTS = 2;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function actionId(options, prefix) {
  if (options?.id) return options.id;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${random}`;
}

function actionTime(options) {
  return options?.now || new Date().toISOString();
}

function sourceProduct(data, source) {
  const [kind, id] = String(source || "").split(":");
  if (kind === "course") return data.courses.find((item) => item.id === id)?.productName || "";
  if (kind === "exam") return data.exams.find((item) => item.id === id)?.productName || "";
  if (kind === "phrase") return data.phrases.find((item) => item.id === id)?.productName || "";
  return "";
}

function productAward(data, source, productName, requested) {
  if (data.goldenBeanLedger.some((entry) => entry.source === source)) return 0;
  const cap = PRODUCT_REWARD_CAPS[productName];
  if (!Number.isFinite(cap)) return Math.max(0, requested);
  const earned = data.goldenBeanLedger.reduce((sum, entry) => {
    if (Number(entry.delta || 0) <= 0 || sourceProduct(data, entry.source) !== productName) return sum;
    return sum + Number(entry.delta || 0);
  }, 0);
  return Math.max(0, Math.min(requested, cap - earned));
}

function syncRanking(data) {
  data.ranking = data.ranking
    .map((item) => item.id === data.employee.id
      ? { ...item, name: data.employee.name, storeId: data.employee.storeId, store: data.employee.store, goldenBeans: data.employee.goldenBeans }
      : item)
    .sort((left, right) => Number(right.goldenBeans || 0) - Number(left.goldenBeans || 0));
}

function demoCompletionRate(data) {
  const values = [];
  data.courses.filter((item) => item.status === "published").forEach((course) => {
    values.push(course.completed ? 100 : Math.max(0, Math.min(100, Number(course.progress || 0))));
  });
  data.phrases.filter((item) => item.status === "published").forEach((phrase) => {
    const limit = Math.max(1, Math.trunc(Number(phrase.maxRewardedAttempts || 1)));
    const completed = Math.min(limit, data.submissions.filter((item) => item.type === "phrase" && item.phraseId === phrase.id && item.status === "approved").length);
    for (let index = 0; index < limit; index += 1) values.push(index < completed ? 100 : 0);
  });
  data.exams.filter((item) => item.status === "published").forEach((exam) => values.push(exam.completed ? 100 : 0));
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function addLedger(data, { source, delta, reason }, options) {
  if (!delta) return;
  data.goldenBeanLedger.unshift({
    id: actionId(options, "demo-ledger"),
    employeeId: data.employee.id,
    source,
    delta,
    reason,
    createdAt: actionTime(options)
  });
  data.employee.goldenBeans = Math.max(0, Number(data.employee.goldenBeans || 0) + delta);
  syncRanking(data);
}

function completeCourse(data, payload, options) {
  const course = data.courses.find((item) => item.id === payload.courseId);
  if (!course) fail("资料不存在，请返回后重试", "COURSE_NOT_FOUND");
  const source = `course:${course.id}`;
  const delta = course.completed ? 0 : productAward(data, source, course.productName || "", Number(course.goldenBeans || 0));
  data.courses = data.courses.map((item) => item.id === course.id ? { ...item, completed: true, progress: 100 } : item);
  const productName = course.productName || "";
  const productCourses = data.courses.filter((item) => (item.productName || "") === productName);
  if (productName && productCourses.length && productCourses.every((item) => item.completed)) {
    data.exams = data.exams.map((item) => item.productName === productName && item.learningResetRequired
      ? { ...item, attempts: 0, attemptCycle: Number(item.attemptCycle || 0) + 1, learningResetRequired: false }
      : item);
  }
  const completed = data.courses.filter((item) => item.completed).length;
  data.employee.courseCompletionRate = demoCompletionRate(data);
  addLedger(data, { source, delta, reason: `完成内部资料：${course.title}` }, options);
  return {
    message: delta ? `资料完成，获得 ${delta} 金豆` : "这项资料已经完成",
    data: { award: { delta }, completed: true }
  };
}

function recordCourseLearningProgress(data, payload) {
  const course = data.courses.find((item) => item.id === payload.courseId);
  if (!course) fail("资料不存在，请返回后重试", "COURSE_NOT_FOUND");
  if (payload.resourceType === "ppt") {
    data.courses = data.courses.map((item) => item.id === course.id
      ? { ...item, learningCompleted: true, progress: 100, pptProgress: { ...(item.pptProgress || {}), completed: true, readingCompleted: true, progress: 100 } }
      : item);
  } else {
    const duration = Math.max(0, Number(course.videoProgress?.videoDurationSeconds || course.videoDurationSeconds || 0));
    data.courses = data.courses.map((item) => item.id === course.id
      ? { ...item, learningCompleted: true, progress: 100, videoProgress: { ...(item.videoProgress || {}), maxWatchedSeconds: duration, videoDurationSeconds: duration, videoWatchCompleted: true } }
      : item);
  }
  data.employee.courseCompletionRate = demoCompletionRate(data);
  return { message: "学习进度已同步", data: { courseId: course.id, learningCompleted: true } };
}

function submitExam(data, payload, options) {
  const exam = data.exams.find((item) => item.id === payload.examId);
  if (!exam) fail("测评不存在，请返回后重试", "EXAM_NOT_FOUND");
  if (exam.learningResetRequired) fail("请重新阅读资料、看完该产品视频，并逐项点击完成后恢复两次考试机会", "EXAM_RELEARNING_REQUIRED");
  const attemptsUsed = Number(exam.attempts || 0);
  if (attemptsUsed >= MAX_EXAM_ATTEMPTS) fail("本学习周期的两次考试机会已用完，请重新完成该产品资料", "EXAM_ATTEMPTS_EXHAUSTED");
  const score = Math.max(0, Math.min(100, Number(payload.score || 0)));
  const passed = Boolean(payload.passed);
  const nextAttemptsUsed = attemptsUsed + 1;
  const relearningRequired = !passed && nextAttemptsUsed >= MAX_EXAM_ATTEMPTS;
  const source = `exam:${exam.id}`;
  const delta = passed && !exam.completed
    ? productAward(data, source, exam.productName || "", Number(exam.goldenBeans || 0))
    : 0;
  data.exams = data.exams.map((item) => item.id === exam.id
    ? { ...item, attempts: Number(item.attempts || 0) + 1, learningResetRequired: relearningRequired, completed: Boolean(item.completed || passed) }
    : item);
  if (relearningRequired) {
    const productName = exam.productName || "";
    data.courses = data.courses.map((item) => item.productName === productName
      ? { ...item, completed: false, progress: 0 }
      : item);
    data.employee.courseCompletionRate = demoCompletionRate(data);
  }
  if (passed) data.employee.examPassRate = Math.max(Number(data.employee.examPassRate || 0), score);
  data.employee.courseCompletionRate = demoCompletionRate(data);
  addLedger(data, { source, delta, reason: `通过测评：${exam.title}` }, options);
  return {
    message: passed
      ? `测评通过，得分 ${score}${delta ? `，获得 ${delta} 金豆` : ""}`
      : relearningRequired
        ? `本次得分 ${score}，请重新完成该产品资料`
        : `本次得分 ${score}，还可再考一次`,
    data: { score, passed, award: { delta }, attemptsUsed: nextAttemptsUsed, attemptsRemaining: Math.max(0, MAX_EXAM_ATTEMPTS - nextAttemptsUsed), relearningRequired }
  };
}

function submitPhrase(data, payload, options) {
  const phrase = data.phrases.find((item) => item.id === payload.phraseId);
  if (!phrase) fail("话术不存在，请返回后重试", "PHRASE_NOT_FOUND");
  if (Number(payload.duration || 0) < 2) fail("录音时间太短，请完整说出练习话术", "RECORDING_TOO_SHORT");
  const attempts = data.submissions.filter((item) => item.type === "phrase" && item.phraseId === phrase.id).length;
  const maxAttempts = Number(phrase.maxRewardedAttempts || 1);
  const source = `phrase:${phrase.id}:${attempts + 1}`;
  const delta = attempts < maxAttempts
    ? productAward(data, source, phrase.productName || "", Number(phrase.goldenBeans || 0))
    : 0;
  const createdAt = actionTime(options);
  const submissionId = actionId(options, "demo-phrase");
  const recordingFileId = payload.recordingFileId || "";
  data.submissions.unshift({
    id: submissionId,
    type: "phrase",
    title: `${phrase.title}练习`,
    employeeId: data.employee.id,
    storeId: data.employee.storeId,
    phraseId: phrase.id,
    recordingFileId,
    status: "approved",
    goldenBeans: delta,
    createdAt,
    content: phrase.script
  });
  if (recordingFileId) {
    data.recordings = [{ id: submissionId, phraseId: phrase.id, title: `${phrase.title}练习`, createdAt, fileId: recordingFileId }, ...(data.recordings || [])];
  }
  data.phrases = data.phrases.map((item) => item.id === phrase.id ? { ...item, submissions: Number(item.submissions || 0) + 1 } : item);
  data.employee.courseCompletionRate = demoCompletionRate(data);
  addLedger(data, { source, delta, reason: `完成开口说：${phrase.title}` }, options);
  return {
    message: delta ? `识别通过，获得 ${delta} 金豆` : "识别通过，本条奖励次数已用完",
    data: { passed: true, transcript: phrase.script, award: { delta } }
  };
}

function deleteRecording(data, payload) {
  const fileId = String(payload.fileId || "").trim();
  if (!fileId) fail("录音不存在", "RECORDING_NOT_FOUND");
  data.recordings = (data.recordings || []).filter((item) => item.fileId !== fileId);
  data.submissions = data.submissions.map((item) => item.recordingFileId === fileId ? { ...item, recordingFileId: "" } : item);
  return { message: "原始录音已删除，练习结果和金豆记录继续保留", data: { fileId, deleted: true } };
}

function publishCase(data, payload, options) {
  const content = String(payload.content || "").trim();
  const images = Array.isArray(payload.images) ? payload.images : [];
  const video = payload.video || null;
  if (payload.casePrivacyConfirmed !== true || payload.casePrivacyVersion !== CASE_PRIVACY_VERSION) fail("请确认案例不包含可识别顾客信息", "CASE_PRIVACY_CONFIRMATION_REQUIRED");
  if (!content && !images.length && !video) fail("请填写案例内容或添加媒体", "CASE_EMPTY");
  if (images.length && video) fail("一条案例不能同时上传图片和视频", "CASE_MEDIA_MIXED");
  if (images.length > 9) fail("一条案例最多上传 9 张图片", "CASE_IMAGE_LIMIT");
  const submission = {
    id: actionId(options, "demo-case"),
    type: "case",
    title: content.slice(0, 24) || "门店案例分享",
    employeeId: data.employee.id,
    storeId: data.employee.storeId,
    publisherName: data.employee.name,
    createdAt: actionTime(options),
    status: "pending",
    goldenBeans: 100,
    content,
    casePrivacyConfirmed: true,
    casePrivacyVersion: CASE_PRIVACY_VERSION,
    ...(images.length ? { images } : {}),
    ...(video ? { videoFileId: video.fileId, videoUrl: video.url, videoSize: video.size } : {})
  };
  data.submissions.unshift(submission);
  return { message: "案例已提交审核，通过后会展示在广场", data: { submission } };
}

function addComment(data, payload, options) {
  const content = String(payload.content || "").trim();
  if (!content) fail("请输入评论内容", "COMMENT_EMPTY");
  const target = data.cases.find((item) => item.id === payload.caseId);
  if (!target) fail("案例不存在或已下架", "CASE_NOT_FOUND");
  const comment = {
    id: actionId(options, "demo-comment"),
    employeeId: data.employee.id,
    employeeName: data.employee.name,
    content,
    createdAt: actionTime(options)
  };
  data.cases = data.cases.map((item) => item.id === target.id
    ? { ...item, commentCount: Number(item.commentCount || 0) + 1, comments: [...(item.comments || []), comment] }
    : item);
  return { message: "评论已发布", data: { comment } };
}

function acknowledgeCase(data, payload, options) {
  const target = data.cases.find((item) => item.id === payload.caseId);
  if (!target || target.status !== "approved" || target.acknowledgementRequired !== true) fail("通知不存在或无需确认", "CASE_ACKNOWLEDGEMENT_NOT_REQUIRED");
  if (target.acknowledgementStatus === "acknowledged") return { message: "该通知已经确认收到", data: { alreadyAcknowledged: true } };
  const acknowledgedAt = actionTime(options);
  data.cases = data.cases.map((item) => item.id === target.id ? {
    ...item,
    acknowledgementStatus: "acknowledged",
    acknowledgedAt,
    acknowledgementAcknowledgedCount: Math.min(Number(item.acknowledgementTargetCount || 0), Number(item.acknowledgementAcknowledgedCount || 0) + 1),
    acknowledgementPendingCount: Math.max(0, Number(item.acknowledgementPendingCount || 0) - 1)
  } : item);
  const applySummary = (employee) => {
    if (employee.id !== data.employee.id) return employee;
    const acknowledged = Math.min(Number(employee.notificationRequiredCount || 0), Number(employee.notificationAcknowledgedCount || 0) + 1);
    const required = Number(employee.notificationRequiredCount || 0);
    return {
      ...employee,
      notificationAcknowledgedCount: acknowledged,
      notificationAcknowledgementRate: required ? Math.round(acknowledged / required * 100) : 0,
      pendingNotifications: (employee.pendingNotifications || []).filter((item) => item.caseId !== target.id)
    };
  };
  data.employee = applySummary(data.employee);
  data.ranking = data.ranking.map(applySummary);
  return { message: "已确认收到", data: { acknowledgedAt } };
}

function redeemReward(data, payload, options) {
  const reward = data.rewards.find((item) => item.id === payload.rewardId);
  if (!reward || reward.status !== "active" || reward.nonDrugConfirmed !== true) fail("该奖励已下架", "REWARD_INACTIVE");
  if (Number(reward.stock || 0) <= 0) fail("该奖励已兑完", "REWARD_SOLD_OUT");
  if (Number(data.employee.goldenBeans || 0) < Number(reward.goldenBeanPrice || 0)) fail("金豆不足，完成岗位任务后再来兑换", "INSUFFICIENT_BEANS");
  const createdAt = actionTime(options);
  const redemptionId = actionId(options, "demo-redemption");
  data.rewards = data.rewards.map((item) => item.id === reward.id ? { ...item, stock: Number(item.stock || 0) - 1 } : item);
  data.redemptions.unshift({
    id: redemptionId,
    rewardId: reward.id,
    employeeId: data.employee.id,
    goldenBeanCost: reward.goldenBeanPrice,
    status: "pending",
    createdAt
  });
  addLedger(data, { source: `redemption:${redemptionId}`, delta: -Number(reward.goldenBeanPrice || 0), reason: `兑换奖励：${reward.title}` }, { ...options, now: createdAt });
  return { message: `已提交「${reward.title}」兑换申请`, data: { goldenBeans: data.employee.goldenBeans, redemptionId } };
}

function redeemStoreTaskReward(data, payload, options) {
  const reward = (data.storeTaskRewards || []).find((item) => item.id === payload.storeTaskRewardId);
  const store = data.stores.find((item) => item.id === data.employee.storeId);
  if (data.employee.role === "supplier" || data.employee.role === "admin") fail("当前账号不能使用门店领取额度", "STORE_TASK_REWARD_FORBIDDEN");
  if (!reward || reward.status !== "active") fail("门店任务兑换品不存在或已停用", "STORE_TASK_REWARD_NOT_FOUND");
  if (!store || store.status === "inactive" || store.organizationType === "department" || reward.storeId !== store.id) fail("当前员工不属于可使用该额度的门店", "STORE_TASK_REWARD_FORBIDDEN");
  if (Number(reward.availableCount || 0) <= 0) fail("本店当前没有可领取额度", "STORE_TASK_REWARD_QUOTA_EXHAUSTED");
  const createdAt = actionTime(options);
  const claimNumber = Number(reward.claimedCount || 0) + 1;
  const redemptionId = actionId(options, "demo-store-task-redemption");
  data.storeTaskRewards = data.storeTaskRewards.map((item) => item.id === reward.id
    ? { ...item, claimedCount: claimNumber, availableCount: Math.max(0, Number(item.availableCount || 0) - 1) }
    : item);
  data.redemptions.unshift({
    id: redemptionId,
    redemptionType: "storeTaskReward",
    storeTaskRewardId: reward.id,
    rewardId: reward.id,
    rewardTitle: reward.title,
    rewardValue: reward.itemValue,
    employeeId: data.employee.id,
    storeId: store.id,
    storeName: store.name,
    productKey: reward.productKey,
    periodKey: reward.periodKey,
    claimNumber,
    goldenBeanCost: 0,
    status: "pending",
    createdAt
  });
  return {
    message: `已提交「${reward.title}」领取申请；商品价值 ¥${reward.itemValue}，不扣金豆`,
    data: { redemptionId, availableCount: Math.max(0, Number(reward.availableCount || 0) - 1), goldenBeansChanged: false }
  };
}

function updateProfile(data, payload) {
  const name = String(payload.name || "").trim();
  const store = data.stores.find((item) => item.id === payload.storeId);
  if (!name) fail("请输入员工姓名", "EMPLOYEE_NAME_REQUIRED");
  if (!store) fail("请选择有效门店", "STORE_NOT_FOUND");
  data.employee = { ...data.employee, name, storeId: store.id, store: store.name };
  syncRanking(data);
  return { message: "资料已更新", data: { employee: data.employee } };
}

export function restoreDemoState(raw, fallbackData) {
  const fallback = clone(fallbackData);
  if (!raw) return fallback;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed?.schemaVersion !== DEMO_SCHEMA_VERSION || !parsed?.data?.employee || !Array.isArray(parsed.data.courses)) return fallback;
    const restored = clone(parsed.data);
    restored.storeTaskRewards ||= clone(fallback.storeTaskRewards || []);
    const fallbackRewardsById = new Map((fallback.rewards || []).map((item) => [item.id, item]));
    const restoredRewards = (Array.isArray(restored.rewards) ? restored.rewards : []).map((item) => (
      item.imageUrl === "/rewards/cartoon-cat.png" && fallbackRewardsById.has(item.id)
        ? { ...item, imageUrl: fallbackRewardsById.get(item.id).imageUrl }
        : item
    ));
    const restoredRewardIds = new Set(restoredRewards.map((item) => item.id));
    restored.rewards = [
      ...restoredRewards,
      ...(fallback.rewards || []).filter((item) => !restoredRewardIds.has(item.id))
    ];
    const restoredCourseIds = new Set((restored.courses || []).map((item) => item.id));
    restored.courses = [
      ...(restored.courses || []),
      ...(fallback.courses || []).filter((item) => !restoredCourseIds.has(item.id))
    ];
    // Keep demo progress, but add newly seeded published cases (including
    // acknowledgement metadata) so an older browser cache does not hide the
    // current case feed or its receive action.
    const restoredCaseIds = new Set((Array.isArray(restored.cases) ? restored.cases : []).map((item) => item.id));
    restored.cases = [
      ...(Array.isArray(restored.cases) ? restored.cases : []),
      ...(fallback.cases || []).filter((item) => !restoredCaseIds.has(item.id))
    ];
    return { ...restored, source: "fallback", bound: true };
  } catch {
    return fallback;
  }
}

export function serializeDemoState(data) {
  return JSON.stringify({ schemaVersion: DEMO_SCHEMA_VERSION, data });
}

export function reduceDemoAction(current, action, payload = {}, options = {}) {
  const data = clone(current);
  let result;
  switch (action) {
    case "completeCourse": result = completeCourse(data, payload, options); break;
    case "recordCourseLearningProgress": result = recordCourseLearningProgress(data, payload); break;
    case "submitExam": result = submitExam(data, payload, options); break;
    case "submitPhrase": result = submitPhrase(data, payload, options); break;
    case "publishCase": result = publishCase(data, payload, options); break;
    case "addComment": result = addComment(data, payload, options); break;
    case "acknowledgeCase": result = acknowledgeCase(data, payload, options); break;
    case "redeemReward": result = redeemReward(data, payload, options); break;
    case "redeemStoreTaskReward": result = redeemStoreTaskReward(data, payload, options); break;
    case "updateProfile": result = updateProfile(data, payload, options); break;
    case "deleteRecording": result = deleteRecording(data, payload); break;
    default: fail("未知的演示操作", "UNKNOWN_DEMO_ACTION");
  }
  return { nextData: data, ...result };
}

export { DEMO_SCHEMA_VERSION };
