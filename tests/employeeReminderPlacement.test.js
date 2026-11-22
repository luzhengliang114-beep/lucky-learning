const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");

test("学习提醒只显示在首页蓝色综合进度区", () => {
  const home = fs.readFileSync(path.join(root, "apps/employee/src/pages/HomePage.tsx"), "utf8");
  const learning = fs.readFileSync(path.join(root, "apps/employee/src/pages/LearningPage.tsx"), "utf8");

  assert.match(home, /className="progress-hero"/);
  assert.match(home, /学习提醒 · 还有/);
  assert.match(home, /className="progress-todo-badge"/);
  assert.match(home, /还有 \$\{todoCount\} 项/);
  assert.match(home, /未完成学习任务/);
  assert.doesNotMatch(home, /<BeanBadge value=\{employee\.goldenBeans\}/);
  assert.doesNotMatch(home, /<LearningTodoPanel/);
  assert.doesNotMatch(learning, /<LearningTodoPanel/);
});

test("首页未完成明细覆盖视频、资料、录音和答题", () => {
  const home = fs.readFileSync(path.join(root, "apps/employee/src/pages/HomePage.tsx"), "utf8");

  assert.match(home, /video: \{ label: "视频"/);
  assert.match(home, /material: \{ label: "资料"/);
  assert.match(home, /audio: \{ label: "录音\/\u5f00口说"/);
  assert.match(home, /exam: \{ label: "答题\/\u8003试"/);
});
