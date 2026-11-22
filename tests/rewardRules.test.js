const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateAwardDelta,
  ledgerEntryMatchesProduct,
  nonNegativeInteger,
  phraseAttemptLimit
} = require("../cloudbase/functions/_shared/rewardRules");

test("clamps the last reward to the product cap", () => {
  assert.equal(calculateAwardDelta({ requested: 2, earned: 49, cap: 50 }), 1);
});

test("awards zero after the product cap", () => {
  assert.equal(calculateAwardDelta({ requested: 6, earned: 50, cap: 50 }), 0);
});

test("accepts zero and rejects invalid reward values", () => {
  assert.equal(nonNegativeInteger(0), 0);
  assert.equal(nonNegativeInteger(-1, 0), 0);
  assert.equal(nonNegativeInteger("abc", 0), 0);
});

test("reads phrase attempt limits from content", () => {
  assert.equal(phraseAttemptLimit({ maxRewardedAttempts: 2 }), 2);
});

test("configured product tasks stop at the reward cap", () => {
  const requestedRewards = [3, 3, 3, 6, 6, 6, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2];
  const awardedRewards = [];
  let earned = 0;

  for (const requested of requestedRewards) {
    const awarded = calculateAwardDelta({ requested, earned, cap: 50 });
    awardedRewards.push(awarded);
    earned += awarded;
  }

  assert.equal(earned, 50);
  assert.equal(awardedRewards.at(-1), 1);
});

test("historical rewards without the current product key do not consume the new cap", () => {
  const sourceIds = ["course-product", "phrase-product"];

  assert.equal(ledgerEntryMatchesProduct(
    { sourceId: "course-product", delta: 60 },
    "测试产品",
    sourceIds
  ), false);
  assert.equal(ledgerEntryMatchesProduct(
    { sourceId: "phrase-product-2", delta: 2 },
    "测试产品",
    sourceIds
  ), false);
  assert.equal(ledgerEntryMatchesProduct(
    { sourceId: "other-course", productKey: "测试产品", delta: 3 },
    "测试产品",
    sourceIds
  ), true);
  assert.equal(ledgerEntryMatchesProduct(
    { sourceId: "other-course", productKey: "其他产品", delta: 3 },
    "测试产品",
    sourceIds
  ), false);
});
