function currentPeriodKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function productKey(item = {}) {
  return stringValue(item.productKey || item.productId || item.productName);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function taskStatus(task) {
  if (!task) return "exam-required";
  return positiveInteger(task.targetQuantity) > 0 && nonNegativeInteger(task.completedQuantity) >= positiveInteger(task.targetQuantity)
    ? "completed"
    : "learning-required";
}

function taskIsCompleted(task) {
  return taskStatus(task) === "completed";
}

function taskLabel(status) {
  return status === "completed" ? "任务已完成" : status === "learning-required" ? "需学习" : "需考试";
}

function taskForProduct(tasks = [], employeeId, key, periodKey = currentPeriodKey()) {
  return tasks.find((task) => String(task.employeeId || "") === String(employeeId || "") && productKey(task) === key && stringValue(task.periodKey) === periodKey) || null;
}

function buildEmployeeProductStatuses({ employeeId, products = [], tasks = [], periodKey = currentPeriodKey() }) {
  return [...new Set(products.map(productKey).filter(Boolean))].map((key) => {
    const task = taskForProduct(tasks, employeeId, key, periodKey);
    const status = taskStatus(task);
    const targetQuantity = task ? positiveInteger(task.targetQuantity) : 0;
    const completedQuantity = task ? nonNegativeInteger(task.completedQuantity) : 0;
    return {
      productKey: key,
      periodKey,
      status,
      label: taskLabel(status),
      hasTaskData: Boolean(task),
      targetQuantity,
      completedQuantity,
      attainmentRate: targetQuantity ? Math.min(100, Math.round(completedQuantity / targetQuantity * 100)) : 0
    };
  });
}

module.exports = { buildEmployeeProductStatuses, currentPeriodKey, nonNegativeInteger, positiveInteger, productKey, taskForProduct, taskIsCompleted, taskLabel, taskStatus };
