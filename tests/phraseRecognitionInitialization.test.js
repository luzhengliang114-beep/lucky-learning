const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const employeeWebSource = readFileSync(
  path.join(__dirname, "..", "cloudbase", "functions", "employeeWeb", "index.js"),
  "utf8"
);

test("phrase recognition does not shadow the product key resolver", () => {
  assert.doesNotMatch(employeeWebSource, /const\s+productKey\s*=\s*productKey\s*\(/);
  assert.match(employeeWebSource, /const\s+phraseProductKey\s*=\s*productKey\s*\(phrase\)/);
});
