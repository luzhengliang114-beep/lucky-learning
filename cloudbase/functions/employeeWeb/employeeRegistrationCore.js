const { createHash, createHmac } = require("node:crypto");

const EMPLOYEE_NOTICE_VERSION = "employee-privacy-2026-07-30";
const RECORDING_NOTICE_VERSION = "recording-use-2026-07-30";
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

function openIdHashFor(openId, secret) {
  const identity = String(openId || "").trim();
  if (!identity) throw codedError("登录身份无效，请重新进入", "LOGIN_ID_REQUIRED");
  const key = String(secret || "").trim();
  if (key.length < 16) throw codedError("员工身份摘要密钥未正确配置", "IDENTITY_HASH_SECRET_INVALID");
  return createHmac("sha256", key).update(identity).digest("hex");
}

function employeeIdForApplication(application = {}) {
  const identityHash = String(application.openIdHash || "").trim();
  if (!identityHash) throw codedError("员工申请身份无效", "APPLICATION_IDENTITY_REQUIRED");
  return `web-${digest(identityHash).slice(0, 20)}`;
}

function resolveRegistrationStore(stores = [], storeId) {
  const targetId = String(storeId || "").trim();
  const store = stores.find((item) => (
    String(item.id || item._id || "").trim() === targetId
    && String(item.status || "active") === "active"
  ));
  if (!store) throw codedError("请选择有效的门店或部门", "ORGANIZATION_NOT_FOUND");
  return store;
}

function assertNoticeVersion(value, expected, code, message) {
  if (String(value || "").trim() !== expected) throw codedError(message, code);
  return true;
}

function assertEmployeeNotice(value) {
  return assertNoticeVersion(
    value,
    EMPLOYEE_NOTICE_VERSION,
    "EMPLOYEE_NOTICE_REQUIRED",
    "请阅读并同意个人信息告知"
  );
}

function buildEmployeeApplication({
  openIdHash,
  wechatProfile = {},
  identityProvider = "wechat-oauth",
  store,
  employeeName,
  noticeVersion,
  resubmissionOf = "",
  reviewRound = 1,
  now = () => new Date().toISOString()
}) {
  const identityHash = String(openIdHash || "").trim();
  if (!identityHash) throw codedError("登录身份无效，请重新进入", "LOGIN_ID_REQUIRED");
  const resolvedStore = resolveRegistrationStore([store], store?.id || store?._id);
  const name = String(employeeName || "").trim();
  if (!name) throw codedError("请输入员工姓名", "EMPLOYEE_NAME_REQUIRED");
  if (name.length > 30) throw codedError("员工姓名不能超过 30 个字符", "EMPLOYEE_NAME_INVALID");
  assertEmployeeNotice(noticeVersion);
  const timestamp = now();
  const round = Math.max(1, Math.trunc(Number(reviewRound || 1)));
  return {
    _id: `application-${digest(`${identityHash}:${timestamp}:${round}`).slice(0, 24)}`,
    openIdHash: identityHash,
    wechatNickname: String(wechatProfile.nickname || "").trim(),
    wechatAvatarUrl: String(wechatProfile.avatarUrl || "").trim(),
    identityProvider: String(identityProvider || "wechat-oauth").trim() || "wechat-oauth",
    employeeName: name,
    storeId: String(resolvedStore.id || resolvedStore._id || "").trim(),
    regionId: String(resolvedStore.regionId || "").trim(),
    status: "pending",
    noticeVersion: EMPLOYEE_NOTICE_VERSION,
    noticeAcceptedAt: timestamp,
    submittedAt: timestamp,
    reviewedAt: "",
    reviewedBy: "",
    rejectionReason: "",
    resubmissionOf: String(resubmissionOf || "").trim(),
    reviewRound: round,
    employeeId: "",
    expiresAt: "",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function updatePendingEmployeeApplication({
  application = {},
  openIdHash,
  store,
  employeeName,
  noticeVersion,
  now = () => new Date().toISOString()
}) {
  const identityHash = String(openIdHash || "").trim();
  if (!identityHash || String(application.openIdHash || "").trim() !== identityHash) {
    throw codedError("只能修改自己的员工申请", "APPLICATION_UPDATE_FORBIDDEN");
  }
  if (application.status !== "pending") {
    throw codedError("当前申请已完成审核，不能继续修改", "APPLICATION_NOT_PENDING");
  }
  const timestamp = now();
  const validated = buildEmployeeApplication({
    openIdHash: identityHash,
    store,
    employeeName,
    noticeVersion,
    reviewRound: application.reviewRound,
    now: () => timestamp
  });
  return {
    ...application,
    employeeName: validated.employeeName,
    storeId: validated.storeId,
    regionId: validated.regionId,
    noticeVersion: validated.noticeVersion,
    noticeAcceptedAt: validated.noticeAcceptedAt,
    submittedAt: validated.submittedAt,
    updatedAt: validated.updatedAt
  };
}

function approvePendingApplicationForKnownEmployee({
  application,
  openIdHash,
  employee = {},
  noticeVersion,
  now = () => new Date().toISOString()
}) {
  const employeeId = String(employee._id || employee.id || "").trim();
  if (!employeeId || !String(employee.storeId || "").trim() || !String(employee.name || "").trim()) {
    throw codedError("总部员工资料无效，请联系管理员", "HEADQUARTERS_EMPLOYEE_INVALID");
  }
  const timestamp = now();
  const updated = updatePendingEmployeeApplication({
    application,
    openIdHash,
    store: {
      id: employee.storeId,
      regionId: employee.regionId || "",
      status: "active"
    },
    employeeName: employee.name,
    noticeVersion,
    now: () => timestamp
  });
  return {
    ...updated,
    status: "approved",
    employeeId,
    reviewedAt: timestamp,
    reviewedBy: "headquarters-auto-match",
    rejectionReason: "",
    updatedAt: timestamp
  };
}

function prepareApplicationSubmission({ applications = [], openIdHash, ...input }) {
  const identityApplications = applications.filter((item) => item.openIdHash === openIdHash);
  const pending = identityApplications.find((item) => item.status === "pending");
  if (pending) {
    return {
      application: updatePendingEmployeeApplication({ application: pending, openIdHash, ...input }),
      created: false,
      updated: true
    };
  }
  const approved = identityApplications.find((item) => item.status === "approved");
  if (approved) throw codedError("当前微信已经通过员工审核", "EMPLOYEE_ALREADY_APPROVED");
  const rejected = [...identityApplications]
    .filter((item) => item.status === "rejected")
    .sort((left, right) => String(right.reviewedAt || right.updatedAt || "").localeCompare(String(left.reviewedAt || left.updatedAt || "")))[0];
  const application = buildEmployeeApplication({
    ...input,
    openIdHash,
    resubmissionOf: rejected?._id || rejected?.id || "",
    reviewRound: Number(rejected?.reviewRound || 0) + 1
  });
  return { application, created: true };
}

function publicApplicationSummary(application = {}) {
  return {
    id: application.id || application._id || "",
    employeeName: application.employeeName || "",
    storeId: application.storeId || "",
    status: application.status || "pending",
    submittedAt: application.submittedAt || application.createdAt || "",
    reviewedAt: application.reviewedAt || "",
    rejectionReason: application.rejectionReason || "",
    reviewRound: Number(application.reviewRound || 1),
    employeeId: application.employeeId || "",
    wechatNickname: application.wechatNickname || "",
    wechatAvatarUrl: application.wechatAvatarUrl || "",
    identityProvider: application.identityProvider || "wechat-oauth"
  };
}

function assertRecordingNotice(value) {
  return assertNoticeVersion(
    value,
    RECORDING_NOTICE_VERSION,
    "RECORDING_NOTICE_REQUIRED",
    "请先阅读并同意录音使用说明"
  );
}

function assertCasePrivacyConfirmation({ confirmed, version } = {}) {
  if (confirmed !== true || String(version || "").trim() !== CASE_PRIVACY_VERSION) {
    throw codedError("请确认案例不包含可识别顾客信息", "CASE_PRIVACY_CONFIRMATION_REQUIRED");
  }
  return true;
}

function filterEligibleRewards(rewards = []) {
  return rewards.filter((reward) => reward.status === "active" && reward.nonDrugConfirmed === true);
}

function rejectedApplicationExpiry(reviewedAt) {
  return addDays(reviewedAt, 30);
}

module.exports = {
  CASE_PRIVACY_VERSION,
  EMPLOYEE_NOTICE_VERSION,
  RECORDING_NOTICE_VERSION,
  approvePendingApplicationForKnownEmployee,
  assertCasePrivacyConfirmation,
  assertEmployeeNotice,
  assertRecordingNotice,
  buildEmployeeApplication,
  employeeIdForApplication,
  filterEligibleRewards,
  openIdHashFor,
  prepareApplicationSubmission,
  publicApplicationSummary,
  rejectedApplicationExpiry,
  resolveRegistrationStore,
  updatePendingEmployeeApplication
};
