function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fail(message, code, candidates = []) {
  const error = new Error(message);
  error.code = code;
  if (candidates.length) error.candidates = candidates;
  throw error;
}

export function resolveDemoScenario(search, enabled, persisted = false) {
  if (!enabled) return null;
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  if (!params.has("demo")) return persisted ? "ready" : null;
  const value = params.get("demo");
  if (value === "1") return "ready";
  if (value === "bind") return "bind";
  if (value === "expired") return "expired";
  return null;
}

export function bindDemoEmployeeData(current, directory, storeId, employeeName) {
  const nameQuery = String(employeeName || "").trim().toLowerCase();
  if (!nameQuery) fail("请输入员工姓名", "EMPLOYEE_NAME_REQUIRED");

  const store = (current.stores || []).find((item) => item.id === storeId);
  if (!store) fail("请选择有效门店", "STORE_NOT_FOUND");

  const matches = (directory || []).filter((employee) => (
    employee.status !== "inactive"
    && employee.storeId === storeId
    && String(employee.name || "").trim().toLowerCase() === nameQuery
  ));
  if (matches.length === 0) {
    fail("总部员工名单中未找到该员工，请核对完整姓名和门店，或联系总部管理员录入。", "EMPLOYEE_NOT_FOUND");
  }
  if (matches.length > 1) {
    fail(
      "员工名单存在同门店同名数据，请联系总部管理员处理。",
      "EMPLOYEE_MATCH_AMBIGUOUS"
    );
  }

  const data = clone(current);
  const match = matches[0];
  const employee = {
    ...data.employee,
    ...clone(match),
    store: store.name,
    goldenBeans: Number.isFinite(Number(match.goldenBeans)) ? Number(match.goldenBeans) : data.employee.goldenBeans,
    courseCompletionRate: Number.isFinite(Number(match.courseCompletionRate)) ? Number(match.courseCompletionRate) : data.employee.courseCompletionRate,
    examPassRate: Number.isFinite(Number(match.examPassRate)) ? Number(match.examPassRate) : data.employee.examPassRate
  };
  let rankingMatchFound = false;
  data.ranking = (data.ranking || []).map((item) => {
    if (item.id !== employee.id) return item;
    rankingMatchFound = true;
    return { ...item, ...employee };
  });
  if (!rankingMatchFound) data.ranking.push({ ...employee });
  data.ranking.sort((left, right) => Number(right.goldenBeans || 0) - Number(left.goldenBeans || 0));
  data.employee = employee;
  data.bound = true;
  return { nextData: data, employee };
}
