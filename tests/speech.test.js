const test = require("node:test");
const assert = require("node:assert/strict");

const {
  compareSpeechText,
  normalizeSpeechText
} = require("../cloudbase/functions/miniProgramApi/speech");

test("speech comparison ignores punctuation spacing and common fillers", () => {
  assert.equal(normalizeSpeechText("嗯，这个 产品！"), "这个产品");
  assert.deepEqual(compareSpeechText("这个产品适合日常使用", "嗯，这个产品适合日常使用。"), {
    matched: true,
    score: 100,
    expectedText: "这个产品适合日常使用",
    actualText: "这个产品适合日常使用"
  });
});

test("speech comparison rejects an unrelated result", () => {
  const result = compareSpeechText("坚持使用可以帮助改善肤色", "今天天气很好");
  assert.equal(result.matched, false);
  assert.ok(result.score < 65);
});
