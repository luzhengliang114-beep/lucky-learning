const HEADQUARTERS_STORE_ID = "company-headquarters";

function normalizedName(value) {
  return String(value || "").trim();
}

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveHeadquartersEmployee({ employees = [], storeId, employeeName } = {}) {
  const isHeadquarters = String(storeId || "").trim() === HEADQUARTERS_STORE_ID;
  if (!isHeadquarters) return { isHeadquarters: false, employee: null };

  const name = normalizedName(employeeName);
  const matches = employees.filter((employee) => (
    String(employee.status || "active") === "active"
    && String(employee.storeId || "").trim() === HEADQUARTERS_STORE_ID
    && normalizedName(employee.name) === name
  ));
  if (matches.length > 1) {
    throw codedError("总部存在多条同名员工资料，请联系管理员处理", "HEADQUARTERS_EMPLOYEE_AMBIGUOUS");
  }
  return {
    isHeadquarters: true,
    employee: matches[0] || null
  };
}

module.exports = {
  HEADQUARTERS_STORE_ID,
  resolveHeadquartersEmployee
};
