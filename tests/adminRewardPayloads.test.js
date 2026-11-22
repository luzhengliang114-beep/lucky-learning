const test = require("node:test");
const assert = require("node:assert/strict");

const {
  requireNonNegativeInteger
} = require("../cloudbase/functions/_shared/rewardRules");

test("accepts zero as an explicit admin reward", () => {
  assert.equal(requireNonNegativeInteger(0, "goldenBeans"), 0);
});

test("accepts configured product caps and phrase attempts", () => {
  assert.equal(requireNonNegativeInteger(50, "rewardCap"), 50);
  assert.equal(requireNonNegativeInteger(2, "maxRewardedAttempts"), 2);
});

test("rejects invalid admin reward values", () => {
  assert.throws(() => requireNonNegativeInteger(-1, "goldenBeans"), /goldenBeans/);
  assert.throws(() => requireNonNegativeInteger(1.5, "goldenBeans"), /goldenBeans/);
  assert.throws(() => requireNonNegativeInteger("abc", "goldenBeans"), /goldenBeans/);
});
