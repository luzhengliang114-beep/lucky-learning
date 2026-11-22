const {
  normalizePeriodKey,
  normalizeStoreProductSale,
  isEligibleStore,
  matchingEligibleStoresByName,
  positiveInteger,
  nonNegativeInteger,
  storeDisplayName,
  storeProductKey,
  storeId
} = require("./_shared/storeProductSales");

function text(value) {
  return String(value || "").trim();
}

function hasInputValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function normalizeStoreProductSaleRow(row = {}, stores = [], timestamp = "") {
  const storeName = text(row.storeName || row.store || row.storeNameText);
  const matches = matchingEligibleStoresByName(stores, storeName);
  if (!storeName) throw new Error("门店不能为空");
  if (matches.length !== 1) throw new Error(matches.length ? "匹配到多个同名门店，请核对门店" : "未找到启用的实体门店");

  const productKey = storeProductKey(row);
  if (!productKey) throw new Error("产品不能为空");
  const periodKey = normalizePeriodKey(row.periodKey || row.period, "");
  if (!periodKey) throw new Error("统计周期必须是 YYYY-MM，例如 2026-09");

  const targetQuantity = positiveInteger(row.targetQuantity ?? row.target);
  if (!targetQuantity) throw new Error("任务目标必须是正整数");
  const completedRaw = row.completedQuantity ?? row.completed;
  const rateRaw = row.attainmentRate ?? row.completionRate ?? row.rate;
  const hasCompleted = hasInputValue(completedRaw);
  const hasRate = hasInputValue(rateRaw);
  if (!hasCompleted && !hasRate) throw new Error("请填写完成数量或达成率");

  let completedQuantity;
  if (hasCompleted) {
    if (!Number.isInteger(Number(completedRaw)) || Number(completedRaw) < 0) throw new Error("完成数量必须是非负整数");
    completedQuantity = nonNegativeInteger(completedRaw);
  } else {
    const rate = Number(String(rateRaw).replace(/%$/, "").trim());
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error("达成率必须是 0-100 的数字");
    completedQuantity = Math.round(targetQuantity * rate / 100);
  }

  return normalizeStoreProductSale({
    productKey,
    periodKey,
    targetQuantity,
    completedQuantity,
    source: text(row.source) || "admin-import"
  }, matches[0], timestamp);
}

function storeProductSalesBusinessKey(record = {}) {
  return `${storeId(record)}::${storeProductKey(record)}::${text(record.periodKey)}`;
}

function storeProductSalesImportRowNumber(row = {}, index = 0) {
  const rowNumber = Number(row.rowNumber);
  return Number.isInteger(rowNumber) && rowNumber > 0 ? rowNumber : index + 2;
}

function prepareStoreProductSaleUpsert(sale = {}, existingByKey = new Map(), timestamp = "") {
  const key = storeProductSalesBusinessKey(sale);
  const previous = existingByKey.get(key);
  const record = {
    ...sale,
    ...(previous?._id ? { _id: previous._id } : {}),
    createdAt: previous?.createdAt || timestamp,
    updatedAt: timestamp
  };
  return { key, previous, record };
}

function prepareUniformStoreProductSales({
  stores = [],
  existing = [],
  productKey: rawProductKey,
  periodKey: rawPeriodKey,
  targetQuantity: rawTargetQuantity,
  timestamp = ""
} = {}) {
  const productKey = text(rawProductKey);
  const periodKey = normalizePeriodKey(rawPeriodKey, "");
  const targetQuantity = positiveInteger(rawTargetQuantity);
  if (!productKey) throw new Error("请选择产品");
  if (!periodKey) throw new Error("统计周期必须是 YYYY-MM");
  if (!targetQuantity) throw new Error("任务目标必须是正整数");

  const eligibleStores = (Array.isArray(stores) ? stores : []).filter(isEligibleStore);
  const existingByKey = new Map((Array.isArray(existing) ? existing : [])
    .map((item) => [storeProductSalesBusinessKey(item), item]));
  let createdCount = 0;
  let updatedCount = 0;
  const records = eligibleStores.map((store) => {
    const key = `${storeId(store)}::${productKey}::${periodKey}`;
    const previous = existingByKey.get(key);
    const completedQuantity = previous ? nonNegativeInteger(previous.completedQuantity) : 0;
    const record = {
      ...(previous?._id ? { _id: previous._id } : {}),
      storeId: storeId(store),
      storeName: storeDisplayName(store),
      productKey,
      periodKey,
      targetQuantity,
      completedQuantity,
      attainmentRate: targetQuantity ? Math.min(100, Math.round(completedQuantity / targetQuantity * 100)) : 0,
      source: "admin-uniform-store-task",
      createdAt: previous?.createdAt || timestamp,
      updatedAt: timestamp
    };
    if (previous) updatedCount += 1;
    else createdCount += 1;
    return record;
  });

  return {
    productKey,
    periodKey,
    targetQuantity,
    affectedStoreCount: eligibleStores.length,
    createdCount,
    updatedCount,
    excludedStoreCount: (Array.isArray(stores) ? stores.length : 0) - eligibleStores.length,
    preservedCompletedQuantity: records.reduce((sum, item) => sum + item.completedQuantity, 0),
    records
  };
}

module.exports = {
  normalizeStoreProductSaleRow,
  storeProductSalesBusinessKey,
  prepareStoreProductSaleUpsert,
  prepareUniformStoreProductSales,
  storeProductSalesImportRowNumber
};
