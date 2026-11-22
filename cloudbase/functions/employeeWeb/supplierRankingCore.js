const { buildProductTaskRankings } = require("./productTaskRankingCore");

function text(value) {
  return String(value || "").trim();
}

function uniqueProductKeys(productKeys = []) {
  return [...new Set((Array.isArray(productKeys) ? productKeys : []).map(text).filter(Boolean))];
}

function employeeId(employee = {}) {
  return text(employee.id || employee._id);
}

function productGoldenBeansByEmployee({ employees = [], ledger = [], productKeys = [] } = {}) {
  const allowedProducts = uniqueProductKeys(productKeys);
  const allowedSet = new Set(allowedProducts);
  const result = Object.fromEntries(employees.map((employee) => [
    employeeId(employee),
    Object.fromEntries(allowedProducts.map((product) => [product, 0]))
  ]).filter(([id]) => Boolean(id)));

  ledger.forEach((entry) => {
    const id = text(entry.employeeId);
    const product = text(entry.productKey || entry.productName || entry.productId);
    const delta = Number(entry.delta || 0);
    if (!result[id] || !allowedSet.has(product) || !Number.isFinite(delta) || delta <= 0) return;
    result[id][product] += delta;
  });

  return result;
}

function supplierProductTaskRankings({ employees = [], tasks = [], periodKey = "", productKeys = [] } = {}) {
  const allowedProducts = uniqueProductKeys(productKeys);
  const generated = buildProductTaskRankings({ employees, tasks, periodKey });
  const generatedByProduct = new Map(generated.map((ranking) => [ranking.productKey, ranking]));

  return allowedProducts.map((product) => {
    const ranking = generatedByProduct.get(product);
    const rowByEmployee = new Map((ranking?.rows || []).map((row) => [employeeId(row), { ...row, hasTaskData: true }]));
    const rows = employees.map((employee) => {
      const id = employeeId(employee);
      return rowByEmployee.get(id) || {
        ...employee,
        id,
        targetQuantity: 0,
        completedQuantity: 0,
        attainmentRate: 0,
        hasTaskData: false
      };
    }).filter((row) => Boolean(row.id)).sort((left, right) => (
      Number(right.hasTaskData) - Number(left.hasTaskData)
      || Number(right.attainmentRate || 0) - Number(left.attainmentRate || 0)
      || Number(right.completedQuantity || 0) - Number(left.completedQuantity || 0)
      || text(left.name).localeCompare(text(right.name), "zh-CN")
      || text(left.id).localeCompare(text(right.id))
    ));

    return {
      productKey: product,
      productName: product,
      periodKey: text(periodKey),
      rows
    };
  });
}

module.exports = {
  productGoldenBeansByEmployee,
  supplierProductTaskRankings,
  uniqueProductKeys
};
