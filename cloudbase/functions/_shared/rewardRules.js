const DEFAULT_PRODUCT_REWARD_CAP = 50;

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function positiveInteger(value, fallback = 1) {
  const number = nonNegativeInteger(value, fallback);
  return number > 0 ? number : fallback;
}

function calculateAwardDelta({ requested, earned, cap = DEFAULT_PRODUCT_REWARD_CAP }) {
  const safeRequested = nonNegativeInteger(requested, 0);
  const safeEarned = nonNegativeInteger(earned, 0);
  const safeCap = nonNegativeInteger(cap, DEFAULT_PRODUCT_REWARD_CAP);
  return Math.min(safeRequested, Math.max(0, safeCap - safeEarned));
}

function phraseAttemptLimit(phrase = {}) {
  return positiveInteger(phrase.maxRewardedAttempts, 1);
}

function ledgerEntryMatchesProduct(entry = {}, productKey) {
  if (!productKey) {
    return false;
  }
  return entry.productKey === productKey;
}

function requireNonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return number;
}

module.exports = {
  DEFAULT_PRODUCT_REWARD_CAP,
  calculateAwardDelta,
  ledgerEntryMatchesProduct,
  nonNegativeInteger,
  phraseAttemptLimit,
  positiveInteger,
  requireNonNegativeInteger
};
