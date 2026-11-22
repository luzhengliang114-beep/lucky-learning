export function normalizeRankingValue(value, mode) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  if (mode === "completion") return Math.round(Math.max(0, Math.min(100, number)));
  return Math.max(0, number);
}

export function rankingValue(employee, mode) {
  return normalizeRankingValue(
    mode === "completion"
      ? employee?.courseCompletionRate
      : mode === "notifications"
        ? employee?.notificationAcknowledgementRate
        : employee?.goldenBeans,
    mode === "notifications" ? "completion" : mode
  );
}

export function sortRanking(ranking, mode) {
  const rows = Array.isArray(ranking) ? ranking : [];
  return rows
    .map((employee, originalIndex) => ({ employee, originalIndex }))
    .sort((left, right) => {
      const valueDifference = rankingValue(right.employee, mode) - rankingValue(left.employee, mode);
      if (valueDifference) return valueDifference;

      if (mode === "completion" || mode === "notifications") {
        if (mode === "notifications") {
          const dataDifference = Number(Boolean(right.employee?.notificationAcknowledgementHasData)) - Number(Boolean(left.employee?.notificationAcknowledgementHasData));
          if (dataDifference) return dataDifference;
          const countDifference = Number(right.employee?.notificationAcknowledgedCount || 0) - Number(left.employee?.notificationAcknowledgedCount || 0);
          if (countDifference) return countDifference;
        }
        const beanDifference = rankingValue(right.employee, "beans") - rankingValue(left.employee, "beans");
        if (beanDifference) return beanDifference;
        const nameDifference = String(left.employee?.name || "").localeCompare(String(right.employee?.name || ""), "zh-CN");
        if (nameDifference) return nameDifference;
      }

      return left.originalIndex - right.originalIndex;
    })
    .map(({ employee }) => employee);
}

export function employeeRank(ranking, employeeId) {
  const index = (Array.isArray(ranking) ? ranking : []).findIndex((employee) => employee?.id === employeeId);
  return index >= 0 ? index + 1 : null;
}

export function sortProductTaskRanking(ranking) {
  const rows = Array.isArray(ranking) ? ranking : [];
  return rows
    .map((employee, originalIndex) => ({ employee, originalIndex }))
    .sort((left, right) => {
      const rateDifference = normalizeRankingValue(right.employee?.attainmentRate, "completion")
        - normalizeRankingValue(left.employee?.attainmentRate, "completion");
      if (rateDifference) return rateDifference;
      const nameDifference = String(left.employee?.name || "").localeCompare(String(right.employee?.name || ""), "zh-CN");
      return nameDifference || left.originalIndex - right.originalIndex;
    })
    .map(({ employee }) => employee);
}

export function sortStoreProductRankingRows(ranking) {
  const rows = Array.isArray(ranking) ? ranking : [];
  return rows
    .map((store, originalIndex) => ({ store, originalIndex }))
    .sort((left, right) => (
      normalizeRankingValue(right.store?.attainmentRate, "completion")
        - normalizeRankingValue(left.store?.attainmentRate, "completion")
      || Number(right.store?.completedQuantity || 0) - Number(left.store?.completedQuantity || 0)
      || String(left.store?.storeName || "").localeCompare(String(right.store?.storeName || ""), "zh-CN")
      || left.originalIndex - right.originalIndex
    ))
    .map(({ store }, index) => ({ ...store, rank: index + 1 }));
}

export function supplierProductRankingValue(employee, productKey, mode) {
  const values = mode === "completion" ? employee?.productCompletionRates : employee?.productGoldenBeans;
  return normalizeRankingValue(values?.[productKey], mode);
}

export function sortSupplierProductRanking(ranking, productKey, mode) {
  const rows = Array.isArray(ranking) ? ranking : [];
  return rows
    .map((employee, originalIndex) => ({ employee, originalIndex }))
    .sort((left, right) => {
      const difference = supplierProductRankingValue(right.employee, productKey, mode)
        - supplierProductRankingValue(left.employee, productKey, mode);
      if (difference) return difference;
      const nameDifference = String(left.employee?.name || "").localeCompare(String(right.employee?.name || ""), "zh-CN");
      return nameDifference || left.originalIndex - right.originalIndex;
    })
    .map(({ employee }) => employee);
}

export function sortSupplierProductTaskRanking(ranking) {
  const rows = Array.isArray(ranking) ? ranking : [];
  return rows
    .map((employee, originalIndex) => ({ employee, originalIndex }))
    .sort((left, right) => (
      Number(Boolean(right.employee?.hasTaskData)) - Number(Boolean(left.employee?.hasTaskData))
      || normalizeRankingValue(right.employee?.attainmentRate, "completion") - normalizeRankingValue(left.employee?.attainmentRate, "completion")
      || Number(right.employee?.completedQuantity || 0) - Number(left.employee?.completedQuantity || 0)
      || String(left.employee?.name || "").localeCompare(String(right.employee?.name || ""), "zh-CN")
      || left.originalIndex - right.originalIndex
    ))
    .map(({ employee }) => employee);
}
