function normalizeMatchText(value) {
  return String(value || "").trim().toLowerCase();
}

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isAllowlistedEmployee(employee = {}) {
  const source = normalizeMatchText(employee.source);
  return String(employee.status || "active") === "active"
    && source !== "direct_login"
    && source !== "self_login";
}

function resolveStoreById(stores = [], storeId) {
  const targetId = String(storeId || "").trim();
  const store = stores.find((item) => (
    String(item._id || item.id || "").trim() === targetId
    && String(item.status || "active") === "active"
  ));
  if (!store) throw codedError("没有找到这个门店，请重新选择", "STORE_NOT_FOUND");
  return store;
}

function resolveStoreByName(stores = [], storeName) {
  const query = normalizeMatchText(storeName);
  const matches = stores.filter((item) => (
    String(item.status || "active") === "active"
    && normalizeMatchText(item.name) === query
  ));
  if (matches.length === 0) throw codedError("没有找到这个门店，请确认店名是否和后台一致", "STORE_NOT_FOUND");
  if (matches.length > 1) throw codedError("后台存在重复门店名称，请联系总部管理员处理", "STORE_AMBIGUOUS");
  return matches[0];
}

function resolveAllowlistedEmployee(employees = [], storeId, employeeName) {
  const query = normalizeMatchText(employeeName);
  if (!query) throw codedError("请输入员工姓名", "EMPLOYEE_NAME_REQUIRED");
  const matches = employees.filter((employee) => (
    isAllowlistedEmployee(employee)
    && String(employee.storeId || "").trim() === String(storeId || "").trim()
    && normalizeMatchText(employee.name) === query
  ));
  if (matches.length === 0) {
    throw codedError("总部员工名单中未找到该员工，请核对完整姓名和门店，或联系总部管理员录入。", "EMPLOYEE_NOT_FOUND");
  }
  if (matches.length > 1) {
    throw codedError("员工名单存在同门店同名数据，请联系总部管理员处理。", "EMPLOYEE_AMBIGUOUS");
  }
  return matches[0];
}

module.exports = {
  isAllowlistedEmployee,
  normalizeMatchText,
  resolveAllowlistedEmployee,
  resolveStoreById,
  resolveStoreByName
};
