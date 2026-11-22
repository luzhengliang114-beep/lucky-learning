function text(value) {
  return String(value || "").trim();
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function productTaskAttainmentRate(task = {}) {
  const targetQuantity = positiveInteger(task.targetQuantity);
  const completedQuantity = nonNegativeInteger(task.completedQuantity);
  return targetQuantity ? Math.min(100, Math.round(completedQuantity / targetQuantity * 100)) : 0;
}

function buildProductTaskRankings({ employees = [], tasks = [], periodKey = "" } = {}) {
  const employeeById = new Map(employees
    .filter((employee) => employee.status === "active" && employee.role !== "supplier")
    .map((employee) => [text(employee.id || employee._id), employee]));
  const productRows = new Map();

  tasks.forEach((task) => {
    if (text(task.periodKey) !== text(periodKey)) return;
    const productKey = text(task.productKey || task.productName || task.productId);
    const employeeId = text(task.employeeId);
    const targetQuantity = positiveInteger(task.targetQuantity);
    const employee = employeeById.get(employeeId);
    if (!productKey || !employee || !targetQuantity) return;

    const rows = productRows.get(productKey) || new Map();
    const completedQuantity = nonNegativeInteger(task.completedQuantity);
    rows.set(employeeId, {
      id: employeeId,
      name: text(employee.name),
      employeeNo: text(employee.employeeNo),
      position: text(employee.position),
      role: employee.role,
      storeId: text(employee.storeId),
      store: text(employee.store),
      regionId: text(employee.regionId),
      status: employee.status,
      avatarUrl: text(employee.avatarUrl),
      targetQuantity,
      completedQuantity,
      attainmentRate: productTaskAttainmentRate({ targetQuantity, completedQuantity })
    });
    productRows.set(productKey, rows);
  });

  return [...productRows.entries()]
    .map(([productKey, rows]) => ({
      productKey,
      productName: productKey,
      periodKey: text(periodKey),
      rows: [...rows.values()].sort((left, right) => (
        right.attainmentRate - left.attainmentRate
        || left.name.localeCompare(right.name, "zh-CN")
        || left.id.localeCompare(right.id)
      ))
    }))
    .sort((left, right) => left.productName.localeCompare(right.productName, "zh-CN"));
}

module.exports = { buildProductTaskRankings, productTaskAttainmentRate };
