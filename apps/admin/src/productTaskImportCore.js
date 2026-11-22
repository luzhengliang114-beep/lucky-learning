const headerAliases = {
  name: ["姓名", "员工姓名", "name"],
  storeName: ["门店", "门店/部门", "部门", "store", "storeName"],
  productKey: ["产品", "产品名称", "product", "productKey", "productName"],
  periodKey: ["统计周期", "周期", "月份", "period", "periodKey"],
  targetQuantity: ["任务目标", "目标", "任务数", "target", "targetQuantity"],
  completedQuantity: ["完成数量", "实际完成", "完成", "completed", "completedQuantity"],
  attainmentRate: ["达成率", "完成率", "达成", "attainmentRate", "completionRate"]
};

function csvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function pick(record, aliases) {
  const key = aliases.find((alias) => Object.prototype.hasOwnProperty.call(record, alias));
  return key ? String(record[key] ?? "").trim() : "";
}

function wholeNumber(value, label, rowNumber, allowZero) {
  const number = Number(value);
  if (!Number.isInteger(number) || (allowZero ? number < 0 : number <= 0)) {
    throw new Error(`第 ${rowNumber} 行${label}必须是${allowZero ? "非负" : "正"}整数`);
  }
  return number;
}

function rateNumber(value, label, rowNumber) {
  const number = Number(String(value ?? "").replace(/%$/, "").trim());
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new Error(`第 ${rowNumber} 行${label}必须是 0-100 的数字`);
  }
  return number;
}

export function productTaskRecordsFromMatrix(matrix = []) {
  if (!Array.isArray(matrix) || matrix.length < 2) throw new Error("任务表中没有数据");
  const headers = matrix[0].map((value) => String(value ?? "").trim());
  const records = matrix.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  const rows = records.map((record, index) => {
    const rowNumber = index + 2;
    const name = pick(record, headerAliases.name);
    const storeName = pick(record, headerAliases.storeName);
    const productKey = pick(record, headerAliases.productKey);
    if (!name || !storeName || !productKey) throw new Error(`第 ${rowNumber} 行缺少姓名、门店或产品`);
    return {
      rowNumber,
      name,
      storeName,
      productKey,
      periodKey: pick(record, headerAliases.periodKey),
      targetQuantity: wholeNumber(pick(record, headerAliases.targetQuantity), "任务目标", rowNumber, false),
      completedQuantity: (() => {
        const completed = pick(record, headerAliases.completedQuantity);
        if (completed !== "") return wholeNumber(completed, "完成数量", rowNumber, true);
        const rate = pick(record, headerAliases.attainmentRate);
        if (rate === "") throw new Error(`第 ${rowNumber} 行请填写完成数量或达成率`);
        return Math.round(wholeNumber(pick(record, headerAliases.targetQuantity), "任务目标", rowNumber, false) * rateNumber(rate, "达成率", rowNumber) / 100);
      })()
    };
  });
  if (!rows.length) throw new Error("任务表中没有数据");
  return rows;
}

export function parseProductTaskCsv(text) {
  return productTaskRecordsFromMatrix(csvRows(text));
}

export function productTaskImportTemplate() {
  return [
    "姓名,门店,产品,统计周期,任务目标,完成数量,达成率",
    "示例员工,总部,示例产品A,2026-08,10,8,80"
  ].join("\n");
}
