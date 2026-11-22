const { createHash } = require("node:crypto");
const { isEligibleStore, nonNegativeInteger, normalizePeriodKey, positiveInteger, storeDisplayName, storeId } = require("./storeProductSales");

const DEFAULT_STORE_TASK_REWARD_THRESHOLD = 10;

function text(value) {
  if (value && typeof value === "object") {
    if (typeof value.toHexString === "function") return value.toHexString().trim();
    if (typeof value.$oid === "string") return value.$oid.trim();
    if (typeof value.id === "string") return value.id.trim();
    if (typeof value._id === "string") return value._id.trim();
  }
  return String(value || "").trim();
}

function normalizeStoreTaskReward(reward = {}) {
  const productKey = text(reward.productKey || reward.productName);
  const id = text(reward.id || reward._id);
  const itemValue = Number(reward.itemValue ?? reward.value ?? 0);
  const threshold = positiveInteger(reward.threshold || DEFAULT_STORE_TASK_REWARD_THRESHOLD) || DEFAULT_STORE_TASK_REWARD_THRESHOLD;
  return {
    ...(id ? { id } : {}),
    productKey,
    title: text(reward.title) || `${productKey} 1盒`,
    description: text(reward.description) || `每完成 ${threshold} 盒销售任务，可领取 1 盒。`,
    itemValue: Number.isFinite(itemValue) && itemValue >= 0 ? itemValue : 0,
    threshold,
    status: reward.status === "inactive" ? "inactive" : "active",
    createdAt: text(reward.createdAt),
    updatedAt: text(reward.updatedAt)
  };
}

function matchingStoreTaskRewardClaims(claims = [], { storeId: storeIdValue, productKey, periodKey } = {}) {
  const key = text(storeIdValue);
  const product = text(productKey);
  const period = normalizePeriodKey(periodKey, "");
  return (Array.isArray(claims) ? claims : []).filter((claim) => (
    claim.redemptionType === "storeTaskReward"
    && text(claim.storeId) === key
    && text(claim.productKey) === product
    && text(claim.periodKey) === period
  ));
}

function calculateStoreTaskRewardQuota({ employee = {}, store = {}, reward = {}, sales = [], claims = [], periodKey = "" } = {}) {
  const normalizedReward = normalizeStoreTaskReward(reward);
  const currentPeriod = normalizePeriodKey(periodKey, "");
  const currentStoreId = storeId(store);
  const eligibleEmployee = employee.status !== "inactive"
    && employee.status !== "disabled"
    && employee.role !== "supplier"
    && employee.role !== "admin"
    && text(employee.storeId) === currentStoreId;
  const eligible = Boolean(
    eligibleEmployee
    && isEligibleStore(store)
    && normalizedReward.productKey
    && normalizedReward.status === "active"
    && currentPeriod
  );
  const sale = eligible ? (Array.isArray(sales) ? sales : []).find((item) => (
    text(item.storeId) === currentStoreId
    && text(item.productKey || item.productName) === normalizedReward.productKey
    && normalizePeriodKey(item.periodKey || item.period, "") === currentPeriod
  )) : null;
  const completedQuantity = nonNegativeInteger(sale?.completedQuantity);
  const earnedCount = eligible ? Math.floor(completedQuantity / normalizedReward.threshold) : 0;
  const matchingClaims = eligible ? matchingStoreTaskRewardClaims(claims, {
    storeId: currentStoreId,
    productKey: normalizedReward.productKey,
    periodKey: currentPeriod
  }) : [];
  const claimedCount = matchingClaims.length;
  return {
    eligible,
    storeId: currentStoreId,
    storeName: storeDisplayName(store),
    productKey: normalizedReward.productKey,
    periodKey: currentPeriod,
    threshold: normalizedReward.threshold,
    targetQuantity: positiveInteger(sale?.targetQuantity),
    completedQuantity,
    earnedCount,
    claimedCount,
    availableCount: Math.max(0, earnedCount - claimedCount),
    reward: normalizedReward
  };
}

function buildStoreTaskRewardOffers({ employee = {}, store = {}, rewards = [], sales = [], claims = [], periodKey = "" } = {}) {
  return (Array.isArray(rewards) ? rewards : [])
    .filter((reward) => reward?.status !== "inactive")
    .map((reward) => {
      const quota = calculateStoreTaskRewardQuota({ employee, store, reward, sales, claims, periodKey });
      return { id: text(reward?.id || reward?._id), ...quota, ...quota.reward };
    });
}

function buildStoreTaskRewardClaimId({ storeId: storeIdValue, productKey, periodKey, claimNumber } = {}) {
  const ordinal = positiveInteger(claimNumber);
  const period = normalizePeriodKey(periodKey, "");
  if (!text(storeIdValue) || !text(productKey) || !period || !ordinal) throw new Error("门店任务领取标识参数无效");
  const bucket = createHash("sha256")
    .update(`${text(storeIdValue)}::${text(productKey)}::${period}`)
    .digest("hex")
    .slice(0, 24);
  return `store-task-${bucket}-${String(ordinal).padStart(4, "0")}`;
}

module.exports = {
  DEFAULT_STORE_TASK_REWARD_THRESHOLD,
  buildStoreTaskRewardOffers,
  buildStoreTaskRewardClaimId,
  calculateStoreTaskRewardQuota,
  matchingStoreTaskRewardClaims,
  normalizeStoreTaskReward
};
