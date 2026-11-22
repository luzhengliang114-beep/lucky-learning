const { createHash } = require("node:crypto");

function text(value) {
  return String(value || "").trim();
}

function dateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(date);
}

function todoSummary(todos = []) {
  return todos.reduce((groups, item) => {
    const product = text(item.productName || item.productKey) || "其他资料";
    const group = groups.get(product) || { productName: product, items: [] };
    group.items.push(item);
    groups.set(product, group);
    return groups;
  }, new Map());
}

function summaryText(todos = []) {
  const groups = [...todoSummary(todos).values()];
  if (!groups.length) return "全部学习项目已完成";
  return groups.map((group) => {
    const labels = group.items.reduce((counts, item) => {
      const type = item.type === "material" ? "资料" : item.type === "audio" ? "录音" : item.type === "exam" ? "考试" : "视频";
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {});
    const detail = Object.entries(labels).map(([label, count]) => `${label}${count > 1 ? ` ${count} 项` : ""}`).join("、");
    return `${group.productName}：${detail}`;
  }).join("；");
}

function summaryHash(todos = []) {
  const normalized = todos.map((item) => ({ id: item.id, type: item.type, productKey: item.productKey, progress: item.progress, status: item.status, locked: item.locked }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function logKey({ employeeId, day = dateKey(), hash = "" } = {}) {
  return `${text(employeeId)}:${day}:${text(hash)}`;
}

function shouldNotify({ employee = {}, user = {}, todos = [] } = {}) {
  return employee.status === "active"
    && employee.role !== "supplier"
    && Boolean(text(user.openId))
    && todos.length > 0;
}

module.exports = {
  dateKey,
  logKey,
  shouldNotify,
  summaryHash,
  summaryText,
  todoSummary
};
