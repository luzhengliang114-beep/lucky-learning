const { createHash } = require("node:crypto");

const roleAliases = new Map([
  ["", "employee"],
  ["普通员工", "employee"],
  ["员工", "employee"],
  ["employee", "employee"],
  ["店长", "storeManager"],
  ["storemanager", "storeManager"],
  ["管理员", "admin"],
  ["admin", "admin"]
]);

const statusAliases = new Map([
  ["", "active"],
  ["启用", "active"],
  ["active", "active"],
  ["停用", "inactive"],
  ["inactive", "inactive"]
]);

function text(value) {
  return String(value || "").trim();
}

function keyText(value) {
  return text(value).toLowerCase();
}

function stableEmployeeNo(storeId, name) {
  const digest = createHash("sha256").update(`${storeId}:${keyText(name)}`).digest("hex").slice(0, 10).toUpperCase();
  return `IMP-${digest}`;
}

function countBy(values) {
  return values.reduce((counts, value) => {
    if (!value) return counts;
    counts.set(value, (counts.get(value) || 0) + 1);
    return counts;
  }, new Map());
}

function buildEmployeeImportPlan({ rows = [], stores = [], employees = [], timestamp = new Date().toISOString() } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { items: [], errors: [{ rowNumber: 0, message: "员工名单中没有数据" }], summary: { total: 0, created: 0, updated: 0, skipped: 0, failed: 1 } };
  }
  if (rows.length > 500) {
    return { items: [], errors: [{ rowNumber: 0, message: "单次最多导入 500 名员工" }], summary: { total: rows.length, created: 0, updated: 0, skipped: 0, failed: rows.length } };
  }

  function brandIdsFor(row) {
    const brand = keyText(row.brandName);
    if (!brand) return [];
    return [...new Set(stores
      .filter((store) => keyText(store.brandId) === brand || keyText(store.brandName) === brand)
      .map((store) => text(store.brandId))
      .filter(Boolean))];
  }

  const employeeNoCounts = countBy(rows.map((row) => keyText(row.employeeNo)));
  const identityCounts = countBy(rows.map((row) => {
    const [brandId] = brandIdsFor(row);
    return brandId ? `${brandId}:${keyText(row.storeName)}:${keyText(row.name)}` : "";
  }));
  const errors = [];
  const planned = [];

  rows.forEach((row, index) => {
    const rowNumber = Number(row.rowNumber || index + 2);
    const name = text(row.name);
    const position = text(row.position);
    const [brandId, duplicateBrand] = brandIdsFor(row);
    const storeName = text(row.storeName);
    const employeeNoInput = text(row.employeeNo);
    const role = roleAliases.get(keyText(row.role));
    const status = statusAliases.get(keyText(row.status));
    const rowErrors = [];

    if (!name) rowErrors.push("缺少姓名");
    if (!brandId) rowErrors.push("找不到品牌，请使用组织管理中的品牌名称或 ID");
    if (duplicateBrand) rowErrors.push("品牌名称重复，请填写品牌 ID");
    if (!storeName) rowErrors.push("缺少门店/部门");
    if (!position) rowErrors.push("缺少职位");
    if (!role) rowErrors.push("系统角色无效");
    if (!status) rowErrors.push("状态无效");
    if (employeeNoInput && employeeNoCounts.get(keyText(employeeNoInput)) > 1) rowErrors.push("员工编号在文件中重复");
    const identityKey = brandId ? `${brandId}:${keyText(storeName)}:${keyText(name)}` : "";
    if (identityKey && identityCounts.get(identityKey) > 1) rowErrors.push("同一门店/部门的员工姓名在文件中重复");

    const matchingStores = brandId ? stores.filter((store) => (
      String(store.status || "active") === "active"
      && text(store.brandId) === brandId
      && keyText(store.name) === keyText(storeName)
    )) : [];
    if (brandId && storeName && matchingStores.length === 0) rowErrors.push("找不到启用的门店/部门");
    if (matchingStores.length > 1) rowErrors.push("门店/部门名称重复，请先整理组织资料");

    const store = matchingStores[0];
    let existing = null;
    if (employeeNoInput) {
      const employeeMatches = employees.filter((employee) => keyText(employee.employeeNo) === keyText(employeeNoInput));
      if (employeeMatches.length > 1) rowErrors.push("数据库中存在重复员工编号");
      existing = employeeMatches[0] || null;
    } else if (store && name) {
      const employeeMatches = employees.filter((employee) => (
        String(employee.storeId || "") === String(store._id || store.id || "")
        && keyText(employee.name) === keyText(name)
      ));
      if (employeeMatches.length > 1) rowErrors.push("该组织存在多名同名员工，请填写员工编号");
      existing = employeeMatches[0] || null;
    }

    if (store && name) {
      const currentEmployeeId = String(existing?._id || existing?.id || "");
      const duplicateNameInStore = employees.find((employee) => (
        String(employee.storeId || "") === String(store._id || store.id || "")
        && keyText(employee.name) === keyText(name)
        && String(employee._id || employee.id || "") !== currentEmployeeId
      ));
      if (duplicateNameInStore) rowErrors.push("该门店已存在同名员工，请核对姓名或门店");
    }

    const employeeNo = employeeNoInput || text(existing?.employeeNo) || (store ? stableEmployeeNo(store._id || store.id, name) : "");
    if (employeeNo) {
      const collision = employees.find((employee) => (
        keyText(employee.employeeNo) === keyText(employeeNo)
        && String(employee._id || employee.id || "") !== String(existing?._id || existing?.id || "")
      ));
      if (collision) rowErrors.push("员工编号已被其他员工使用");
    }

    if (rowErrors.length > 0) {
      errors.push({ rowNumber, name, message: rowErrors.join("；") });
      return;
    }

    planned.push({
      rowNumber,
      action: existing ? "update" : "create",
      employeeId: existing?._id || existing?.id || "",
      document: {
        name,
        employeeNo,
        position,
        role,
        storeId: store._id || store.id,
        regionId: text(store.regionId) || "default",
        source: "admin",
        status,
        updatedAt: timestamp
      }
    });
  });

  const items = errors.length === 0 ? planned : [];
  return {
    items,
    errors,
    summary: {
      total: rows.length,
      created: items.filter((item) => item.action === "create").length,
      updated: items.filter((item) => item.action === "update").length,
      skipped: 0,
      failed: errors.length
    }
  };
}

module.exports = {
  buildEmployeeImportPlan,
  stableEmployeeNo
};
