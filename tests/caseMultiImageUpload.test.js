const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");

test("员工案例图片支持多选、追加和单张删除", () => {
  const source = fs.readFileSync(path.join(root, "apps/employee/src/pages/CasesPage.tsx"), "utf8");

  assert.match(source, /accept="image\/\*" multiple/);
  assert.match(source, /\[\.\.\.current, \.\.\.images\]/);
  assert.match(source, /function removeFile\(index: number\)/);
  assert.match(source, /最多上传 9 张图片/);
});

test("正式后台案例表单支持多图上传、预览删除并按数组保存", () => {
  const source = fs.readFileSync(path.join(root, "apps/admin/src/main.tsx"), "utf8");

  assert.match(source, /imageUrls: string\[\]/);
  assert.match(source, /案例图片（可多选，最多 9 张）/);
  assert.match(source, /disabled=\{isUploading \|\| values\.length >= 9\}/);
  assert.match(source, /multiple/);
  assert.match(source, /images: caseForm\.imageUrls\.map/);
});
