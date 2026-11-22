function isNormalStoreEmployee(employee = {}, stores = []) {
  if (!employee || employee.status !== "active" || employee.role === "admin" || employee.role === "supplier") return false;
  const store = stores.find((item) => String(item._id || item.id) === String(employee.storeId || ""));
  return Boolean(store && store.status !== "inactive" && store.organizationType !== "department");
}

function mergeUniformTask({ employee, store, existing, productKey, periodKey, targetQuantity, timestamp }) {
  const completedQuantity = Math.max(0, Number(existing?.completedQuantity || 0));
  return {
    ...(existing?._id ? { _id: existing._id } : {}),
    employeeId: employee._id || employee.id,
    employeeName: employee.name,
    storeId: employee.storeId,
    storeName: store?.name || "",
    productKey,
    periodKey,
    targetQuantity,
    completedQuantity,
    attainmentRate: Math.min(100, Math.round(completedQuantity / targetQuantity * 100)),
    source: "admin-uniform-task",
    updatedBy: "headquarters-admin",
    updatedAt: timestamp
  };
}

function clearUniformTaskRecords(records = [], productKey, periodKey) {
  const normalizedProductKey = String(productKey || "").trim();
  const normalizedPeriodKey = String(periodKey || "").trim();
  const kept = [];
  let deletedCount = 0;
  for (const record of records) {
    const matches = String(record?.productKey || "").trim() === normalizedProductKey
      && String(record?.periodKey || "").trim() === normalizedPeriodKey
      && String(record?.source || "") === "admin-uniform-task";
    if (matches) deletedCount += 1;
    else kept.push(record);
  }
  return { records: kept, deletedCount };
}

module.exports = { clearUniformTaskRecords, isNormalStoreEmployee, mergeUniformTask };
