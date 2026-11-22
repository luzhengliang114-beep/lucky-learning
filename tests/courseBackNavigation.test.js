const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");

test("课程返回立即关闭详情，不等待刷新请求", () => {
  const source = fs.readFileSync(path.join(root, "apps/employee/src/pages/LearningPage.tsx"), "utf8");
  const handler = source.slice(source.indexOf("function returnFromCourse()"), source.indexOf("function changeTrack"));

  assert.ok(handler.indexOf("setDetail(null)") < handler.indexOf("refresh()"));
  assert.doesNotMatch(handler, /await\s+refresh\(\)/);
});

test("视频返回先触发后台进度同步，再立即退出页面", () => {
  const source = fs.readFileSync(path.join(root, "apps/employee/src/pages/LearningPage.tsx"), "utf8");
  const backHandler = source.match(/onBack=\{\(\) => \{([\s\S]*?)\}\}\s*\/>/)?.[1] || "";

  assert.match(backHandler, /flushProgress\(\)/);
  assert.match(backHandler, /onBack\(\)/);
  assert.doesNotMatch(backHandler, /finally\(onBack\)/);
});
