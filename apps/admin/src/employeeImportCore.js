const headerAliases = {
  name: ["姓名", "员工姓名", "name"],
  brandName: ["品牌", "品牌名称", "brand", "brandName"],
  storeName: ["门店/部门", "门店", "部门", "组织", "store", "storeName"],
  position: ["职位", "岗位", "职务", "position"],
  employeeNo: ["员工编号", "工号", "employeeNo"],
  role: ["系统角色", "角色", "role"],
  status: ["状态", "status"]
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
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function pick(record, aliases) {
  const key = aliases.find((alias) => Object.prototype.hasOwnProperty.call(record, alias));
  return key ? String(record[key] ?? "").trim() : "";
}

export function normalizeEmployeeImportRecords(records = [], firstDataRow = 2) {
  return records
    .map((record, index) => ({
      rowNumber: firstDataRow + index,
      name: pick(record, headerAliases.name),
      brandName: pick(record, headerAliases.brandName),
      storeName: pick(record, headerAliases.storeName),
      position: pick(record, headerAliases.position),
      employeeNo: pick(record, headerAliases.employeeNo),
      role: pick(record, headerAliases.role),
      status: pick(record, headerAliases.status)
    }))
    .filter((row) => [row.name, row.brandName, row.storeName, row.position, row.employeeNo, row.role, row.status].some(Boolean));
}

export function employeeRecordsFromMatrix(matrix = []) {
  if (!Array.isArray(matrix) || matrix.length < 2) throw new Error("员工名单中没有数据");
  const headers = matrix[0].map((value) => String(value ?? "").trim());
  const records = matrix.slice(1).map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? ""])
  ));
  const rows = normalizeEmployeeImportRecords(records);
  if (rows.length === 0) throw new Error("员工名单中没有数据");
  return rows;
}

export function parseEmployeeCsv(text) {
  const rows = csvRows(text);
  if (rows.length < 2) throw new Error("员工名单中没有数据");
  return employeeRecordsFromMatrix(rows);
}

export function employeeImportTemplate(brandName = "示例企业", storeName = "示例门店") {
  const csvCell = (value) => `"${String(value).replaceAll('"', '""')}"`;
  return [
    "姓名,品牌,门店/部门,职位,员工编号,系统角色,状态",
    `示例员工,${csvCell(brandName)},${csvCell(storeName)},店员,,普通员工,启用`
  ].join("\n");
}
