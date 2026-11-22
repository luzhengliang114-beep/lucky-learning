function text(value) {
  return String(value || "").trim();
}

function employeeId(employee = {}) {
  return text(employee._id || employee.id);
}

function productKey(item = {}) {
  return text(item.productKey || item.productId || item.productName || item.title);
}

function isSupplier(employee = {}) {
  return text(employee.role) === "supplier";
}

function allowedProductKeys(employee = {}) {
  return Array.isArray(employee.supplierProductKeys)
    ? employee.supplierProductKeys.map(text).filter(Boolean)
    : [];
}

function canViewProduct(employee = {}, item = {}) {
  if (!isSupplier(employee)) return true;
  return allowedProductKeys(employee).includes(productKey(item));
}

function canViewCase(employee = {}, item = {}) {
  if (!isSupplier(employee)) return true;
  return canViewProduct(employee, item)
    && Array.isArray(item.visibleSupplierIds)
    && item.visibleSupplierIds.map(text).includes(employeeId(employee));
}

function isNormalStoreStaff(employee = {}, stores = []) {
  if (employee.status !== "active" || isSupplier(employee) || text(employee.role) === "admin") return false;
  const store = stores.find((item) => text(item._id || item.id) === text(employee.storeId));
  return Boolean(store && store.status !== "inactive" && store.organizationType !== "department");
}

function filterSupplierData(employee = {}, { courses = [], phrases = [], exams = [], cases = [], employees = [], stores = [] } = {}) {
  const visibleEmployees = employees.filter((item) => (
    stores.length
      ? isNormalStoreStaff(item, stores)
      : item.status === "active" && !isSupplier(item) && text(item.role) !== "admin"
  ));
  return {
    courses: courses.filter((item) => canViewProduct(employee, item)),
    phrases: phrases.filter((item) => canViewProduct(employee, item)),
    exams: exams.filter((item) => canViewProduct(employee, item)),
    cases: cases.filter((item) => canViewCase(employee, item)),
    employees: visibleEmployees
  };
}

module.exports = {
  allowedProductKeys,
  canViewCase,
  canViewProduct,
  employeeId,
  filterSupplierData,
  isSupplier,
  isNormalStoreStaff,
  productKey
};
