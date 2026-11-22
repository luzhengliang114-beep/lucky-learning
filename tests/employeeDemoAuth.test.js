const test = require("node:test");
const assert = require("node:assert/strict");

async function demoAuth() {
  return import("../apps/employee/src/demoAuthCore.js");
}

function demoState() {
  return {
    source: "fallback",
    bound: false,
    employee: {
      id: "employee-1",
      name: "旧姓名",
      employeeNo: "GZ1001",
      role: "employee",
      storeId: "store-1",
      store: "示例门店",
      regionId: "south",
      goldenBeans: 1280,
      courseCompletionRate: 92,
      examPassRate: 100,
      status: "active"
    },
    stores: [
      { id: "store-1", name: "示例门店", regionId: "south" },
      { id: "store-2", name: "示例门店二", regionId: "south" }
    ],
    courses: [],
    phrases: [],
    exams: [],
    rewards: [],
    submissions: [],
    cases: [],
    ranking: [
      { id: "employee-1", name: "旧姓名", employeeNo: "GZ1001", role: "employee", storeId: "store-1", store: "示例门店", regionId: "south", goldenBeans: 1280, courseCompletionRate: 92, examPassRate: 100, status: "active" }
    ],
    goldenBeanLedger: [],
    redemptions: []
  };
}

const directory = [
  { id: "employee-1", name: "林可", employeeNo: "GZ1001", role: "employee", storeId: "store-1", regionId: "south", status: "active" },
  { id: "duplicate-1", name: "测试同名", employeeNo: "DEMO2001", role: "employee", storeId: "store-1", regionId: "south", status: "active" },
  { id: "duplicate-2", name: "测试同名", employeeNo: "DEMO2002", role: "employee", storeId: "store-1", regionId: "south", status: "active" }
];

test("demo auth scenarios require an explicit enabled gate", async () => {
  const { resolveDemoScenario } = await demoAuth();

  assert.equal(resolveDemoScenario("?demo=1", false, true), null);
  assert.equal(resolveDemoScenario("?demo=bind", false, false), null);
  assert.equal(resolveDemoScenario("?demo=expired", false, false), null);
  assert.equal(resolveDemoScenario("?demo=pending", false, false), null);

  assert.equal(resolveDemoScenario("?demo=1", true, false), "ready");
  assert.equal(resolveDemoScenario("?demo=bind", true, false), "bind");
  assert.equal(resolveDemoScenario("?demo=expired", true, false), "expired");
  assert.equal(resolveDemoScenario("?demo=pending", true, false), null);
  assert.equal(resolveDemoScenario("?demo=rejected", true, false), null);
  assert.equal(resolveDemoScenario("", true, true), "ready");
  assert.equal(resolveDemoScenario("?demo=unknown", true, true), null);
});

test("demo employee binding accepts one exact match and synchronizes ranking", async () => {
  const { bindDemoEmployeeData } = await demoAuth();
  const result = bindDemoEmployeeData(demoState(), directory, "store-1", " 林可 ");

  assert.equal(result.employee.id, "employee-1");
  assert.equal(result.nextData.bound, true);
  assert.equal(result.nextData.employee.name, "林可");
  assert.equal(result.nextData.employee.store, "示例门店");
  assert.equal(result.nextData.ranking[0].name, "林可");
});

test("demo employee binding rejects partial, missing, and multiple matches without mutation", async () => {
  const { bindDemoEmployeeData } = await demoAuth();
  const partialState = demoState();
  const partialBefore = JSON.stringify(partialState);
  assert.throws(
    () => bindDemoEmployeeData(partialState, directory, "store-1", "林"),
    (error) => error.code === "EMPLOYEE_NOT_FOUND"
  );
  assert.equal(JSON.stringify(partialState), partialBefore);

  const missingState = demoState();
  const missingBefore = JSON.stringify(missingState);

  assert.throws(
    () => bindDemoEmployeeData(missingState, directory, "store-1", "不存在"),
    (error) => error.code === "EMPLOYEE_NOT_FOUND"
  );
  assert.equal(JSON.stringify(missingState), missingBefore);

  const multipleState = demoState();
  const multipleBefore = JSON.stringify(multipleState);
  assert.throws(
    () => bindDemoEmployeeData(multipleState, directory, "store-1", "测试同名"),
    (error) => error.code === "EMPLOYEE_MATCH_AMBIGUOUS" && !error.candidates
  );
  assert.equal(JSON.stringify(multipleState), multipleBefore);
});

test("demo employee binding validates the selected store and employee name", async () => {
  const { bindDemoEmployeeData } = await demoAuth();

  assert.throws(
    () => bindDemoEmployeeData(demoState(), directory, "missing-store", "林可"),
    (error) => error.code === "STORE_NOT_FOUND"
  );
  assert.throws(
    () => bindDemoEmployeeData(demoState(), directory, "store-1", "   "),
    (error) => error.code === "EMPLOYEE_NAME_REQUIRED"
  );
});
