const { createHash } = require("node:crypto");
const CASE_PRIVACY_VERSION = "case-deidentification-2026-07-30";

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function addDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function recordingRetentionExpiry(inactiveAt) {
  return addDays(inactiveAt, 90);
}

function employeeForApplication(application, timestamp) {
  const openIdHash = String(application.openIdHash || "").trim();
  if (!openIdHash) throw codedError("员工申请身份无效", "APPLICATION_IDENTITY_REQUIRED");
  const employeeId = `web-${digest(openIdHash).slice(0, 20)}`;
  const manualReview = application.identityProvider === "manual-review";
  return {
    _id: employeeId,
    name: String(application.employeeName || "").trim(),
    employeeNo: `${manualReview ? "MR" : "WX"}-${digest(openIdHash).slice(0, 10).toUpperCase()}`,
    role: "employee",
    storeId: String(application.storeId || "").trim(),
    regionId: String(application.regionId || "").trim(),
    goldenBeans: 0,
    courseCompletionRate: 0,
    examPassRate: 0,
    avatarUrl: "",
    wechatAvatarUrl: String(application.wechatAvatarUrl || "").trim(),
    wechatNickname: String(application.wechatNickname || "").trim(),
    status: "active",
    source: manualReview ? "manual_review_approved" : "oauth_admin_approved",
    applicationId: application._id || application.id || "",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function reviewEmployeeApplication(application = {}, {
  decision,
  rejectionReason = "",
  reviewedBy = "web-admin",
  now = () => new Date().toISOString()
} = {}) {
  if (!["approved", "rejected"].includes(decision)) {
    throw codedError("审核结果无效", "APPLICATION_DECISION_INVALID");
  }
  if (application.status !== "pending") {
    return { application, employee: null, alreadyReviewed: true };
  }
  const reason = String(rejectionReason || "").trim();
  if (decision === "rejected" && !reason) {
    throw codedError("请填写拒绝原因", "REJECTION_REASON_REQUIRED");
  }
  const timestamp = now();
  const employee = decision === "approved" ? employeeForApplication(application, timestamp) : null;
  return {
    alreadyReviewed: false,
    employee,
    application: {
      ...application,
      status: decision,
      reviewedAt: timestamp,
      reviewedBy: String(reviewedBy || "web-admin").trim() || "web-admin",
      rejectionReason: decision === "rejected" ? reason : "",
      employeeId: employee?._id || "",
      expiresAt: decision === "rejected" ? addDays(timestamp, 30) : "",
      updatedAt: timestamp
    }
  };
}

function publicEmployeeApplication(application = {}) {
  const { _id, openIdHash, ...publicFields } = application;
  return {
    ...publicFields,
    id: application.id || _id || "",
    status: application.status || "pending",
    reviewRound: Number(application.reviewRound || 1)
  };
}

function assertAdminCasePrivacyConfirmation({ confirmed, version } = {}) {
  if (confirmed !== true || String(version || "").trim() !== CASE_PRIVACY_VERSION) {
    throw codedError("请完成顾客隐私检查", "CASE_PRIVACY_CONFIRMATION_REQUIRED");
  }
  return true;
}

function assertNonDrugRewardConfirmation(confirmed) {
  if (confirmed !== true) {
    throw codedError("请确认礼品不是药品或医疗器械", "NON_DRUG_CONFIRMATION_REQUIRED");
  }
  return true;
}

module.exports = {
  CASE_PRIVACY_VERSION,
  assertAdminCasePrivacyConfirmation,
  assertNonDrugRewardConfirmation,
  employeeForApplication,
  publicEmployeeApplication,
  recordingRetentionExpiry,
  reviewEmployeeApplication
};
