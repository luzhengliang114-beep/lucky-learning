const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function core() {
  const file = pathToFileURL(path.join(__dirname, "../apps/employee/src/refreshCoordinatorCore.js"));
  return import(`${file.href}?test=${Date.now()}-${Math.random()}`);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

test("写操作成功后旧刷新结果不能覆盖新状态，并在旧请求结束后强制拉取最新数据", async () => {
  const { createRefreshCoordinator } = await core();
  const coordinator = createRefreshCoordinator();
  const stale = deferred();
  const fresh = deferred();
  const applied = [];
  let loads = 0;
  const load = () => {
    loads += 1;
    return loads === 1 ? stale.promise : fresh.promise;
  };

  const firstRefresh = coordinator.refresh(load, (value) => applied.push(value));
  coordinator.invalidate();
  const forcedRefresh = coordinator.refresh(load, (value) => applied.push(value), { fresh: true });

  stale.resolve("旧锁定状态");
  await firstRefresh;
  assert.deepEqual(applied, []);
  assert.equal(loads, 2);

  fresh.resolve("最新已解锁状态");
  await forcedRefresh;
  assert.deepEqual(applied, ["最新已解锁状态"]);
});

test("普通并发刷新复用同一个请求", async () => {
  const { createRefreshCoordinator } = await core();
  const coordinator = createRefreshCoordinator();
  const pending = deferred();
  let loads = 0;
  const load = () => {
    loads += 1;
    return pending.promise;
  };

  const first = coordinator.refresh(load, () => undefined);
  const second = coordinator.refresh(load, () => undefined);
  assert.equal(loads, 1);
  pending.resolve("完成");
  assert.equal(await first, "完成");
  assert.equal(await second, "完成");
});

test("课程完成和交卷成功后都会废弃旧刷新，锁定试卷点击时会强制复核服务器", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "../apps/employee/src/App.tsx"), "utf8");
  const examSource = fs.readFileSync(path.join(__dirname, "../apps/employee/src/pages/ExamPage.tsx"), "utf8");
  assert.match(appSource, /refreshCoordinatorRef\.current\.invalidate\(\)/);
  assert.match(appSource, /refresh\(\{ fresh: true \}\)/);
  assert.match(examSource, /refresh\(\{ fresh: true \}\)/);
});
