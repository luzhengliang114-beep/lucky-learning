const {
  addGoldenBeansOnce,
  assertAdmin,
  db,
  fail,
  getFirst,
  now,
  ok,
  requireString
} = require("./_shared/db");

const collectionByType = {
  pop: "popSubmissions",
  phrase: "phraseSubmissions",
  case: "cases"
};

exports.main = async (event = {}, context = {}) => {
  try {
    const openId = context.OPENID || event.openId;
    const submissionType = requireString(event.submissionType, "submissionType");
    const submissionId = requireString(event.submissionId, "submissionId");
    const decision = requireString(event.decision, "decision");
    const rejectReason = typeof event.rejectReason === "string" ? event.rejectReason : "";

    if (!["approved", "rejected"].includes(decision)) {
      return fail("Decision must be approved or rejected", "INVALID_DECISION");
    }

    const admin = await assertAdmin(openId);
    const collectionName = collectionByType[submissionType];
    if (!collectionName) {
      return fail("Unsupported submission type", "INVALID_SUBMISSION_TYPE");
    }

    const submission = await getFirst(collectionName, { _id: submissionId });
    if (!submission) {
      return fail("Submission not found", "SUBMISSION_NOT_FOUND");
    }

    await db.collection(collectionName).doc(submissionId).update({
      status: decision,
      rejectReason: decision === "rejected" ? rejectReason : "",
      reviewedBy: admin._id,
      reviewedAt: now()
    });

    const award = decision === "approved"
      ? await addGoldenBeansOnce({
          employeeId: submission.employeeId,
          sourceType: submissionType,
          sourceId: submissionId,
          delta: Number(submission.goldenBeans || 0),
          reason: `审核通过：${submission.title}`,
          createdBy: admin._id
        })
      : null;

    return ok({
      submissionId,
      status: decision,
      award
    });
  } catch (error) {
    return fail(error.message, "REVIEW_SUBMISSION_FAILED");
  }
};
