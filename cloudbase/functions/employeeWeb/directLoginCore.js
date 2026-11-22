function normalizeMatchText(value) {
  return String(value || "").trim().toLowerCase();
}

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function findStoreById(stores = [], storeId) {
  const targetId = String(storeId || "").trim();
  return stores.find((store) => String(store.id || store._id || "").trim() === targetId) || null;
}

function isAllowlistedEmployee(employee = {}) {
  const source = String(employee.source || "").trim().toLowerCase();
  return String(employee.status || "active") === "active"
    && source !== "direct_login"
    && source !== "self_login";
}

function matchEmployeesByStoreAndName(employees = [], storeId, employeeName) {
  const query = normalizeMatchText(employeeName);
  const targetStoreId = String(storeId || "").trim();
  const storeEmployees = employees.filter((employee) => (
    isAllowlistedEmployee(employee)
    && String(employee.storeId || "").trim() === targetStoreId
  ));
  return storeEmployees.filter((employee) => normalizeMatchText(employee.name) === query);
}

function resolveDirectLoginEmployee({ stores = [], employees = [], storeId, employeeName }) {
  const name = String(employeeName || "").trim();
  if (!name) throw codedError("请输入员工姓名", "EMPLOYEE_NAME_REQUIRED");

  const store = findStoreById(stores, storeId);
  if (!store) throw codedError("请选择有效门店", "STORE_NOT_FOUND");

  const matches = matchEmployeesByStoreAndName(employees, store.id || store._id, name);
  if (matches.length === 0) {
    throw codedError(
      "总部员工名单中未找到该员工，请核对完整姓名和门店，或联系总部管理员录入。",
      "EMPLOYEE_NOT_FOUND"
    );
  }
  if (matches.length > 1) {
    throw codedError(
      "员工名单存在同门店同名数据，请联系总部管理员处理。",
      "EMPLOYEE_AMBIGUOUS"
    );
  }

  return {
    store,
    employee: matches[0]
  };
}

module.exports = {
  findStoreById,
  isAllowlistedEmployee,
  matchEmployeesByStoreAndName,
  normalizeMatchText,
  resolveDirectLoginEmployee
};
