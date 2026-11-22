const {
  addGoldenBeansOnce,
  db,
  fail,
  getFirst,
  now,
  ok,
  requireString
} = require("./_shared/db");

function normalizeQuestionAnswerIndexes(question = {}) {
  if (question.type === "multiple") {
    return (Array.isArray(question.answerIndexes) ? question.answerIndexes : [])
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
  }

  return [Number(question.answerIndex || 0)];
}

function normalizeSubmittedAnswer(answer) {
  if (Array.isArray(answer?.selectedIndexes)) {
    return answer.selectedIndexes
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
  }
  if (Number.isFinite(Number(answer))) {
    return [Number(answer)];
  }
  return [];
}

function sameIndexes(a, b) {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

exports.main = async (event = {}, context = {}) => {
  try {
    const openId = context.OPENID || event.openId;
    const examId = requireString(event.examId, "examId");
    const answers = Array.isArray(event.answers) ? event.answers : [];

    if (!openId) {
      return fail("Missing WeChat openId", "NO_OPENID");
    }

    const user = await getFirst("users", { openId, status: "active" });
    if (!user) {
      return fail("User is not bound to an employee", "USER_NOT_BOUND");
    }

    const exam = await getFirst("exams", { _id: examId, status: "published" });
    if (!exam) {
      return fail("Exam not found or unpublished", "EXAM_NOT_FOUND");
    }

    const questionResult = await db.collection("questions").where({ examId }).get();
    const questions = questionResult.data || [];

    const answerByQuestionId = {};
    answers.forEach((answer, index) => {
      const questionId = answer?.questionId || questions[index]?._id;
      if (questionId) {
        answerByQuestionId[questionId] = normalizeSubmittedAnswer(answer);
      }
    });

    const correctCount = questions.reduce((count, question) => {
      const questionId = question._id || question.id;
      const submitted = answerByQuestionId[questionId] || [];
      return count + (sameIndexes(submitted, normalizeQuestionAnswerIndexes(question)) ? 1 : 0);
    }, 0);
    const score = questions.length === 0 ? 0 : Math.round((correctCount / questions.length) * 100);
    const passed = score >= Number(exam.passScore || 0);

    const attempt = {
      employeeId: user.employeeId,
      examId,
      answers,
      score,
      passed,
      correctCount,
      questionCount: questions.length,
      createdAt: now()
    };
    const attemptResult = await db.collection("examAttempts").add(attempt);

    const award = passed
      ? await addGoldenBeansOnce({
          employeeId: user.employeeId,
          sourceType: "exam",
          sourceId: examId,
          delta: Number(exam.goldenBeans || 0),
          reason: `通过考试：${exam.title}`
        })
      : null;

    return ok({
      attemptId: attemptResult.id,
      score,
      passed,
      correctCount,
      questionCount: questions.length,
      award
    });
  } catch (error) {
    return fail(error.message, "SUBMIT_EXAM_FAILED");
  }
};
