function text(value) {
  return String(value || "").trim();
}

function identityText(value) {
  return text(value).toLowerCase();
}

function employeeId(employee = {}) {
  return text(employee._id || employee.id);
}

function isLegacyManualReviewEmployee(employee = {}) {
  return employeeId(employee).startsWith("web-")
    && text(employee.employeeNo).startsWith("MR-");
}

function buildLegacyDuplicateEmployeeCleanupPlan({ employees = [] } = {}) {
  const candidates = [];
  const skippedWithBalance = [];
  const skippedUnsafe = [];

  for (const legacyEmployee of employees.filter(isLegacyManualReviewEmployee)) {
    if (!["active", "legacy-duplicate-merging"].includes(text(legacyEmployee.status))) {
      continue;
    }

    const matchingFormalEmployees = employees.filter((employee) => (
      !isLegacyManualReviewEmployee(employee)
      && text(employee.status) === "active"
      && text(employee.storeId) === text(legacyEmployee.storeId)
      && identityText(employee.name) === identityText(legacyEmployee.name)
    ));

    if (matchingFormalEmployees.length !== 1) {
      skippedUnsafe.push({
        legacyEmployeeId: employeeId(legacyEmployee),
        name: text(legacyEmployee.name),
        storeId: text(legacyEmployee.storeId),
        reason: matchingFormalEmployees.length === 0
          ? "未找到同门店同名的正式员工"
          : "找到多名同门店同名的正式员工",
        formalMatchCount: matchingFormalEmployees.length
      });
      continue;
    }

    const formalEmployee = matchingFormalEmployees[0];
    const item = {
      legacyEmployeeId: employeeId(legacyEmployee),
      legacyEmployeeNo: text(legacyEmployee.employeeNo),
      formalEmployeeId: employeeId(formalEmployee),
      formalEmployeeNo: text(formalEmployee.employeeNo),
      formalRole: text(formalEmployee.role) || "employee",
      name: text(legacyEmployee.name),
      storeId: text(legacyEmployee.storeId),
      goldenBeans: Math.max(0, Number(legacyEmployee.goldenBeans || 0))
    };

    if (item.goldenBeans > 0) {
      skippedWithBalance.push(item);
      continue;
    }

    candidates.push(item);
  }

  const byId = (left, right) => left.legacyEmployeeId.localeCompare(right.legacyEmployeeId);
  candidates.sort(byId);
  skippedWithBalance.sort(byId);
  skippedUnsafe.sort(byId);

  return {
    candidates,
    skippedWithBalance,
    skippedUnsafe,
    summary: {
      candidateCount: candidates.length,
      protectedWithBalanceCount: skippedWithBalance.length,
      unsafeCount: skippedUnsafe.length
    }
  };
}

function sameEmployeeIdSet(left = [], right = []) {
  const normalize = (values) => [...new Set(values.map(text).filter(Boolean))].sort();
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function relationCollisionKey(collectionName, record = {}) {
  if (collectionName === "courseProgress") return text(record.courseId);
  if (collectionName === "goldenBeanLedger") return `${text(record.sourceType)}:${text(record.sourceId)}`;
  if (collectionName === "employeeProductTasks") return `${text(record.productKey)}:${text(record.periodKey)}`;
  return "";
}

function findRelationCollisions({ candidates = [], recordsByCollection = {} } = {}) {
  const collisions = [];
  for (const collectionName of ["courseProgress", "goldenBeanLedger", "employeeProductTasks"]) {
    const records = Array.isArray(recordsByCollection[collectionName]) ? recordsByCollection[collectionName] : [];
    for (const candidate of candidates) {
      const legacyKeys = new Map(records
        .filter((record) => text(record.employeeId) === candidate.legacyEmployeeId)
        .map((record) => [relationCollisionKey(collectionName, record), text(record._id || record.id)]));
      const formalRecords = records.filter((record) => text(record.employeeId) === candidate.formalEmployeeId);
      for (const formalRecord of formalRecords) {
        const key = relationCollisionKey(collectionName, formalRecord);
        if (key && legacyKeys.has(key)) {
          collisions.push({
            collectionName,
            legacyEmployeeId: candidate.legacyEmployeeId,
            formalEmployeeId: candidate.formalEmployeeId,
            key,
            legacyRecordId: legacyKeys.get(key),
            formalRecordId: text(formalRecord._id || formalRecord.id)
          });
        }
      }
    }
  }
  return collisions;
}

module.exports = {
  buildLegacyDuplicateEmployeeCleanupPlan,
  findRelationCollisions,
  isLegacyManualReviewEmployee,
  sameEmployeeIdSet
};
