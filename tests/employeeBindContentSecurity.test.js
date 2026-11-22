const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "cloudbase", "functions", "employeeWeb", "index.js"),
  "utf8"
);

test("employee binding does not run content security on employee names", () => {
  const start = source.indexOf("async function bindAction");
  const end = source.indexOf("async function applicationStatusAction", start);
  assert.ok(start >= 0 && end > start);
  const bindAction = source.slice(start, end);
  assert.equal(bindAction.includes("assertTextSafe"), false);
});

test("user-authored content still keeps WeChat security checks", () => {
  const submitStart = source.indexOf("async function submitContentAction");
  const commentStart = source.indexOf("async function addCommentAction");
  assert.ok(submitStart >= 0 && commentStart >= 0);
  assert.equal(source.slice(submitStart, commentStart).includes("assertTextSafe"), true);
  assert.equal(source.slice(commentStart).includes("assertTextSafe"), true);
});
