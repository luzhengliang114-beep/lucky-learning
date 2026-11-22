const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CASE_PRIVACY_VERSION,
  EMPLOYEE_NOTICE_VERSION,
  RECORDING_NOTICE_VERSION,
  assertCasePrivacyConfirmation,
  assertRecordingNotice,
  approvePendingApplicationForKnownEmployee,
  buildEmployeeApplication,
  filterEligibleRewards,
  openIdHashFor,
  prepareApplicationSubmission,
  publicApplicationSummary,
  updatePendingEmployeeApplication
} = require("../cloudbase/functions/employeeWeb/employeeRegistrationCore");
const {
  CASE_PRIVACY_VERSION: ADMIN_CASE_PRIVACY_VERSION,
  assertAdminCasePrivacyConfirmation,
  assertNonDrugRewardConfirmation,
  publicEmployeeApplication,
  recordingRetentionExpiry,
  reviewEmployeeApplication
} = require("../cloudbase/functions/adminData/employeeApplicationCore");

const store = {
  id: "org-one",
  name: "示例门店",
  regionId: "shenzhen",
  status: "active"
};
const clock = () => "2026-07-30T10:00:00.000Z";

test("uses a keyed stable identity digest without exposing the raw openid", () => {
  const first = openIdHashFor("openid-one", "identity-secret-long-enough");
  const repeated = openIdHashFor("openid-one", "identity-secret-long-enough");
  const otherSecret = openIdHashFor("openid-one", "another-identity-secret");

  assert.equal(first, repeated);
  assert.notEqual(first, otherSecret);
  assert.equal(first.includes("openid-one"), false);
  assert.throws(() => openIdHashFor("openid-one", "short"), (error) => error.code === "IDENTITY_HASH_SECRET_INVALID");
});

test("admin compliance checks require current case and non-drug confirmations", () => {
  assert.equal(assertAdminCasePrivacyConfirmation({ confirmed: true, version: ADMIN_CASE_PRIVACY_VERSION }), true);
  assert.throws(() => assertAdminCasePrivacyConfirmation({ confirmed: true, version: "old" }), (error) => error.code === "CASE_PRIVACY_CONFIRMATION_REQUIRED");
  assert.equal(assertNonDrugRewardConfirmation(true), true);
  assert.throws(() => assertNonDrugRewardConfirmation(false), (error) => error.code === "NON_DRUG_CONFIRMATION_REQUIRED");
});

test("admin application payload never contains an identity digest", () => {
  const visible = publicEmployeeApplication({
    _id: "application-one",
    openIdHash: "sensitive-digest",
    employeeName: "张三",
    storeId: "org-one",
    status: "pending"
  });
  assert.equal(visible.id, "application-one");
  assert.equal("openIdHash" in visible, false);
  assert.equal(JSON.stringify(visible).includes("sensitive-digest"), false);
});

test("inactive employee recordings enter the deletion range after 90 days", () => {
  assert.equal(recordingRetentionExpiry("2026-07-30T10:00:00.000Z"), "2026-10-28T10:00:00.000Z");
});

test("builds a pending application only with the current privacy notice", () => {
  const application = buildEmployeeApplication({
    openIdHash: "identity-hash",
    wechatProfile: { nickname: "小健", avatarUrl: "https://example.com/avatar.jpg" },
    store,
    employeeName: "  张三  ",
    noticeVersion: EMPLOYEE_NOTICE_VERSION,
    now: clock
  });

  assert.equal(application.status, "pending");
  assert.equal(application.employeeName, "张三");
  assert.equal(application.storeId, "org-one");
  assert.equal(application.noticeVersion, EMPLOYEE_NOTICE_VERSION);
  assert.equal(application.expiresAt, "");
  assert.equal(JSON.stringify(publicApplicationSummary(application)).includes("identity-hash"), false);
  assert.throws(() => buildEmployeeApplication({
    openIdHash: "identity-hash",
    store,
    employeeName: "张三",
    noticeVersion: "old-version"
  }), (error) => error.code === "EMPLOYEE_NOTICE_REQUIRED");
});

test("returns an existing pending application and creates a new round after rejection", () => {
  const pending = buildEmployeeApplication({
    openIdHash: "identity-hash",
    store,
    employeeName: "张三",
    noticeVersion: EMPLOYEE_NOTICE_VERSION,
    now: clock
  });
  const duplicate = prepareApplicationSubmission({
    applications: [pending],
    openIdHash: "identity-hash",
    store,
    employeeName: "张三",
    noticeVersion: EMPLOYEE_NOTICE_VERSION,
    now: clock
  });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.application._id, pending._id);

  const rejected = {
    ...pending,
    status: "rejected",
    reviewedAt: "2026-07-30T11:00:00.000Z",
    rejectionReason: "门店选择错误"
  };
  const resubmitted = prepareApplicationSubmission({
    applications: [rejected],
    openIdHash: "identity-hash",
    store: { ...store, id: "org-two" },
    employeeName: "张三",
    noticeVersion: EMPLOYEE_NOTICE_VERSION,
    now: () => "2026-07-30T12:00:00.000Z"
  });
  assert.equal(resubmitted.created, true);
  assert.equal(resubmitted.application.status, "pending");
  assert.equal(resubmitted.application.resubmissionOf, rejected._id);
  assert.equal(resubmitted.application.reviewRound, 2);
});

test("updates the same pending application for its owning employee session", () => {
  const pending = buildEmployeeApplication({
    openIdHash: "identity-hash",
    store,
    employeeName: "陆振良",
    noticeVersion: EMPLOYEE_NOTICE_VERSION,
    now: clock
  });
  const updated = updatePendingEmployeeApplication({
    application: pending,
    openIdHash: "identity-hash",
    store: { ...store, id: "org-headquarters", regionId: "headquarters" },
    employeeName: "  陆振良  ",
    noticeVersion: EMPLOYEE_NOTICE_VERSION,
    now: () => "2026-08-11T14:00:00.000Z"
  });

  assert.equal(updated._id, pending._id);
  assert.equal(updated.employeeName, "陆振良");
  assert.equal(updated.storeId, "org-headquarters");
  assert.equal(updated.regionId, "headquarters");
  assert.equal(updated.status, "pending");
  assert.equal(updated.reviewRound, pending.reviewRound);
  assert.equal(updated.submittedAt, "2026-08-11T14:00:00.000Z");
  assert.equal(updated.noticeAcceptedAt, "2026-08-11T14:00:00.000Z");
  assert.equal(updated.createdAt, pending.createdAt);
});

test("does not allow another employee session or a reviewed application to be modified", () => {
  const pending = buildEmployeeApplication({
    openIdHash: "identity-hash",
    store,
    employeeName: "陆振良",
    noticeVersion: EMPLOYEE_NOTICE_VERSION,
    now: clock
  });
  const input = {
    application: pending,
    store,
    employeeName: "陆振良",
    noticeVersion: EMPLOYEE_NOTICE_VERSION
  };

  assert.throws(
    () => updatePendingEmployeeApplication({ ...input, openIdHash: "another-identity-hash" }),
    (error) => error.code === "APPLICATION_UPDATE_FORBIDDEN"
  );
  assert.throws(
    () => updatePendingEmployeeApplication({ ...input, application: { ...pending, status: "approved" }, openIdHash: "identity-hash" }),
    (error) => error.code === "APPLICATION_NOT_PENDING"
  );
});

test("completes an existing pending application when a known headquarters employee is matched", () => {
  const pending = buildEmployeeApplication({
    openIdHash: "identity-hash",
    store,
    employeeName: "陆振良",
    noticeVersion: EMPLOYEE_NOTICE_VERSION,
    now: clock
  });
  const approved = approvePendingApplicationForKnownEmployee({
    application: pending,
    openIdHash: "identity-hash",
    employee: {
      _id: "employee-lu-zhenliang",
      name: "陆振良",
      storeId: "company-headquarters",
      regionId: "headquarters",
      status: "active"
    },
    noticeVersion: EMPLOYEE_NOTICE_VERSION,
    now: () => "2026-08-11T14:05:00.000Z"
  });

  assert.equal(approved._id, pending._id);
  assert.equal(approved.status, "approved");
  assert.equal(approved.storeId, "company-headquarters");
  assert.equal(approved.employeeId, "employee-lu-zhenliang");
  assert.equal(approved.reviewedBy, "headquarters-auto-match");
  assert.equal(approved.reviewedAt, "2026-08-11T14:05:00.000Z");
});

test("approves and rejects applications idempotently", () => {
  const application = buildEmployeeApplication({
    openIdHash: "identity-hash",
    store,
    employeeName: "张三",
    noticeVersion: EMPLOYEE_NOTICE_VERSION,
    now: clock
  });
  const approved = reviewEmployeeApplication(application, {
    decision: "approved",
    reviewedBy: "web-admin",
    now: () => "2026-07-30T13:00:00.000Z"
  });
  assert.equal(approved.application.status, "approved");
  assert.equal(approved.employee.status, "active");
  assert.equal(approved.employee.name, "张三");
  assert.equal(approved.employee.storeId, "org-one");

  const repeated = reviewEmployeeApplication(approved.application, {
    decision: "approved",
    reviewedBy: "another-admin"
  });
  assert.equal(repeated.alreadyReviewed, true);
  assert.equal(repeated.employee, null);

  assert.throws(() => reviewEmployeeApplication(application, {
    decision: "rejected",
    rejectionReason: "   ",
    reviewedBy: "web-admin"
  }), (error) => error.code === "REJECTION_REASON_REQUIRED");
});

test("enforces recording, case privacy, and non-drug reward confirmations", () => {
  assert.equal(assertRecordingNotice(RECORDING_NOTICE_VERSION), true);
  assert.throws(() => assertRecordingNotice(""), (error) => error.code === "RECORDING_NOTICE_REQUIRED");
  assert.equal(assertCasePrivacyConfirmation({ confirmed: true, version: CASE_PRIVACY_VERSION }), true);
  assert.throws(
    () => assertCasePrivacyConfirmation({ confirmed: false, version: CASE_PRIVACY_VERSION }),
    (error) => error.code === "CASE_PRIVACY_CONFIRMATION_REQUIRED"
  );

  const eligible = filterEligibleRewards([
    { id: "eligible", status: "active", nonDrugConfirmed: true },
    { id: "legacy", status: "active" },
    { id: "inactive", status: "inactive", nonDrugConfirmed: true }
  ]);
  assert.deepEqual(eligible.map((reward) => reward.id), ["eligible"]);
});
