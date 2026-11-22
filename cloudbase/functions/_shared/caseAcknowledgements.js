function text(value) {
  return String(value || "").trim();
}

function employeeId(employee = {}) {
  return text(employee._id || employee.id);
}

function caseId(item = {}) {
  return text(item._id || item.id);
}

function recipientKey(caseValue, employeeValue) {
  return `${text(caseValue)}:${text(employeeValue)}`;
}

function acknowledgementRecipientRecords({ caseId: caseValue, employees = [], createdAt = "" } = {}) {
  const targetCaseId = text(caseValue);
  if (!targetCaseId) return [];
  return employees.filter(isAcknowledgementAudience).map((employee) => {
    const targetEmployeeId = employeeId(employee);
    return {
      key: recipientKey(targetCaseId, targetEmployeeId),
      caseId: targetCaseId,
      employeeId: targetEmployeeId,
      status: "pending",
      acknowledgedAt: "",
      createdAt: text(createdAt)
    };
  }).filter((item) => item.employeeId);
}

function missingAcknowledgementRecipientRecords({ cases = [], employees = [], recipients = [] } = {}) {
  const existingKeys = new Set(recipients.map((record) => (
    text(record.key) || recipientKey(record.caseId, record.employeeId)
  )));
  const missing = [];
  for (const item of cases) {
    const requiredForAll = isAcknowledgementCase(item);
    const legacyAdminNotice = isLegacyAdminNotice(item);
    if (!requiredForAll && !legacyAdminNotice) continue;
    const audience = employees.filter(isAcknowledgementAudience);
    const generated = acknowledgementRecipientRecords({
      caseId: caseId(item),
      employees: audience,
      createdAt: text(item.createdAt)
    });
    for (const record of generated) {
      if (existingKeys.has(record.key)) continue;
      existingKeys.add(record.key);
      missing.push(record);
    }
  }
  return missing;
}

function writableAcknowledgementRecord(record = {}) {
  const { _id, id, ...document } = record;
  return document;
}

function acknowledgeRecipient(record = {}, acknowledgedAt = "") {
  return {
    ...record,
    status: "acknowledged",
    acknowledgedAt: text(acknowledgedAt),
    updatedAt: text(acknowledgedAt)
  };
}

function isAcknowledgementAudience(employee = {}) {
  return employee.status === "active" && text(employee.role) !== "supplier";
}

function isAcknowledgementCase(item = {}) {
  return item.acknowledgementRequired === true
    && ["approved", "published"].includes(item.status)
    && !item.deletedAt;
}

function isLegacyAdminNotice(item = {}) {
  return !item.acknowledgementRequired
    && (text(item.publisherRole) === "admin" || text(item.createdBy) === "web-admin")
    && ["approved", "published"].includes(item.status)
    && !item.deletedAt;
}

function notificationSummaryForEmployee({ employeeId: targetEmployeeId, employeeRole = "", cases = [], recipients = [] } = {}) {
  const target = text(targetEmployeeId);
  const visibleCases = new Map(cases.filter((item) => isAcknowledgementCase(item) || isLegacyAdminNotice(item)).map((item) => [caseId(item), item]));
  const required = recipients.filter((item) => text(item.employeeId) === target && visibleCases.has(text(item.caseId)));
  // Notices published before acknowledgement tracking was introduced have no
  // recipient rows. Treat them as pending until the migration snapshot is
  // persisted so every active non-supplier sees the same task immediately.
  if (employeeRole) {
    const recordedCaseIds = new Set(required.map((item) => text(item.caseId)));
    for (const item of visibleCases.values()) {
      const id = caseId(item);
      if (!recordedCaseIds.has(id)) required.push({ caseId: id, status: "pending", acknowledgedAt: "" });
    }
  }
  const acknowledged = required.filter((item) => item.status === "acknowledged" || Boolean(item.acknowledgedAt));
  const pendingNotifications = required
    .filter((item) => item.status !== "acknowledged" && !item.acknowledgedAt)
    .map((item) => {
      const source = visibleCases.get(text(item.caseId)) || {};
      return {
        caseId: text(item.caseId),
        title: text(source.title || source.content) || "官方通知",
        productName: text(source.productName),
        createdAt: text(source.createdAt)
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return {
    notificationAcknowledgedCount: acknowledged.length,
    notificationRequiredCount: required.length,
    notificationAcknowledgementRate: required.length ? Math.round(acknowledged.length / required.length * 100) : 0,
    notificationAcknowledgementHasData: required.length > 0,
    pendingNotifications
  };
}

function caseAcknowledgementState({ item = {}, employeeId: targetEmployeeId, employeeRole = "", recipients = [] } = {}) {
  if (!isAcknowledgementCase(item) && !isLegacyAdminNotice(item)) {
    return { acknowledgementStatus: "not-required", acknowledgedAt: "" };
  }
  const record = recipients.find((entry) => text(entry.caseId) === caseId(item) && text(entry.employeeId) === text(targetEmployeeId));
  if (record && (record.status === "acknowledged" || record.acknowledgedAt)) {
    return { acknowledgementStatus: "acknowledged", acknowledgedAt: text(record.acknowledgedAt) };
  }
  if (employeeRole === "admin") return { acknowledgementStatus: "pending", acknowledgedAt: "" };
  return { acknowledgementStatus: "pending", acknowledgedAt: "" };
}

function acknowledgementCounts(item = {}, recipients = []) {
  const id = caseId(item);
  const rows = recipients.filter((entry) => text(entry.caseId) === id);
  const acknowledged = rows.filter((entry) => entry.status === "acknowledged" || Boolean(entry.acknowledgedAt)).length;
  return {
    acknowledgementTargetCount: rows.length,
    acknowledgementAcknowledgedCount: acknowledged,
    acknowledgementPendingCount: Math.max(0, rows.length - acknowledged)
  };
}

module.exports = {
  acknowledgeRecipient,
  acknowledgementRecipientRecords,
  acknowledgementCounts,
  caseAcknowledgementState,
  caseId,
  employeeId,
  isAcknowledgementAudience,
  isAcknowledgementCase,
  isLegacyAdminNotice,
  missingAcknowledgementRecipientRecords,
  notificationSummaryForEmployee,
  recipientKey,
  writableAcknowledgementRecord
};
