function text(value) {
  return String(value || "").trim();
}

function storeLookupKey(value) {
  return text(value).normalize("NFKC").toLowerCase().replace(/[\s|｜/／·・—–-]+/g, "");
}

function storeDisplayName(store = {}) {
  const brandName = text(store.brandName);
  const name = text(store.name || store.storeName || store.store);
  return brandName && name ? `${brandName}｜${name}` : name || brandName;
}

function matchingEligibleStoresByName(stores = [], value = "") {
  const query = storeLookupKey(value);
  if (!query) return [];
  const eligibleStores = (Array.isArray(stores) ? stores : []).filter(isEligibleStore);
  const fullMatches = eligibleStores.filter((store) => storeLookupKey(storeDisplayName(store)) === query);
  if (fullMatches.length) return fullMatches;
  return eligibleStores.filter((store) => storeLookupKey(store.name) === query);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function currentPeriodKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function normalizePeriodKey(value, fallback = currentPeriodKey()) {
  const periodKey = text(value) || fallback;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) return "";
  return periodKey;
}

function storeId(store = {}) {
  return text(store.storeId || store.id || store._id);
}

function storeProductKey(sale = {}) {
  return text(sale.productKey || sale.productName || sale.product);
}

function isEligibleStore(store = {}) {
  return Boolean(
    storeId(store)
    && store.status !== "inactive"
    && text(store.organizationType || "store") !== "department"
  );
}

function storeProductSalesAttainmentRate(sale = {}) {
  const targetQuantity = positiveInteger(sale.targetQuantity);
  const completedQuantity = nonNegativeInteger(sale.completedQuantity);
  return targetQuantity ? Math.min(100, Math.round(completedQuantity / targetQuantity * 100)) : 0;
}

function normalizeStoreProductSale(sale = {}, store = null, timestamp = "") {
  const resolvedStore = store || {};
  const targetQuantity = positiveInteger(sale.targetQuantity);
  const completedQuantity = nonNegativeInteger(sale.completedQuantity);
  const productKey = storeProductKey(sale);
  const periodKey = normalizePeriodKey(sale.periodKey || sale.period);
  return {
    ...(sale._id ? { _id: sale._id } : {}),
    storeId: storeId(resolvedStore) || text(sale.storeId),
    storeName: storeDisplayName(resolvedStore) || text(sale.storeName || sale.store),
    productKey,
    periodKey,
    targetQuantity,
    completedQuantity,
    attainmentRate: storeProductSalesAttainmentRate({ targetQuantity, completedQuantity }),
    source: text(sale.source) || "admin-import",
    ...(timestamp ? { updatedAt: timestamp } : {})
  };
}

function buildStoreProductRankings({ stores = [], sales = [], periodKey = "", productKeys = [] } = {}) {
  const currentPeriod = normalizePeriodKey(periodKey);
  const eligibleStores = new Map(stores.filter(isEligibleStore).map((store) => [storeId(store), store]));
  const allowedProducts = new Set((Array.isArray(productKeys) ? productKeys : []).map(text).filter(Boolean));
  const grouped = new Map();

  for (const sale of Array.isArray(sales) ? sales : []) {
    const salePeriod = normalizePeriodKey(sale.periodKey || sale.period, "");
    const id = text(sale.storeId);
    const productKey = storeProductKey(sale);
    if (!currentPeriod || salePeriod !== currentPeriod || !id || !productKey || !eligibleStores.has(id)) continue;
    if (allowedProducts.size && !allowedProducts.has(productKey)) continue;
    const store = eligibleStores.get(id);
    const targetQuantity = positiveInteger(sale.targetQuantity);
    if (!targetQuantity) continue;
    const completedQuantity = nonNegativeInteger(sale.completedQuantity);
    const productRows = grouped.get(productKey) || new Map();
    productRows.set(id, {
      id,
      storeId: id,
      storeName: storeDisplayName(store),
      targetQuantity,
      completedQuantity,
      attainmentRate: storeProductSalesAttainmentRate({ targetQuantity, completedQuantity })
    });
    grouped.set(productKey, productRows);
  }

  return [...grouped.entries()]
    .map(([productKey, rows]) => {
      const sortedRows = [...rows.values()].sort((left, right) => (
        right.attainmentRate - left.attainmentRate
        || right.completedQuantity - left.completedQuantity
        || left.storeName.localeCompare(right.storeName, "zh-CN")
        || left.storeId.localeCompare(right.storeId)
      ));
      return {
        productKey,
        productName: productKey,
        periodKey: currentPeriod,
        rows: sortedRows.map((row, index) => ({ ...row, rank: index + 1 }))
      };
    })
    .sort((left, right) => left.productName.localeCompare(right.productName, "zh-CN"));
}

function storeProductRankForEmployee(ranking = {}, storeIdValue = "") {
  const id = text(storeIdValue);
  const row = (Array.isArray(ranking.rows) ? ranking.rows : []).find((item) => text(item.storeId || item.id) === id);
  return row ? { rank: Number(row.rank || 0), total: ranking.rows.length, ...row } : null;
}

module.exports = {
  buildStoreProductRankings,
  currentPeriodKey,
  isEligibleStore,
  matchingEligibleStoresByName,
  normalizePeriodKey,
  normalizeStoreProductSale,
  nonNegativeInteger,
  positiveInteger,
  storeProductKey,
  storeProductRankForEmployee,
  storeProductSalesAttainmentRate,
  storeDisplayName,
  storeId
};
