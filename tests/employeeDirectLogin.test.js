const test = require("node:test");
const assert = require("node:assert/strict");

async function loginEntry() {
  return import("../apps/employee/src/loginEntry.js");
}

const {
  matchEmployeesByStoreAndName,
  resolveDirectLoginEmployee
} = require("../cloudbase/functions/employeeWeb/directLoginCore");

test("scan entry keeps OAuth and direct login requires an explicit entry mode", async () => {
  const { resolveLoginEntry } = await loginEntry();

  assert.deepEqual(resolveLoginEntry("?entry=scan&storeId=bx-1011"), {
    mode: "oauth",
    storeId: "bx-1011"
  });
  assert.deepEqual(resolveLoginEntry("?entry=direct&storeId=org-one"), {
    mode: "direct",
    storeId: "org-one"
  });
  assert.deepEqual(resolveLoginEntry("?foo=bar"), {
    mode: "oauth",
    storeId: ""
  });
});

test("direct login only accepts an exact active allowlisted employee", () => {
  const employees = [
    { _id: "e-1", name: "林可", employeeNo: "GZ1001", storeId: "org-one", status: "active" },
    { _id: "e-2", name: "陈宇", employeeNo: "SZ2048", storeId: "org-one", status: "active" },
    { _id: "e-3", name: "陈宇", employeeNo: "SZ2049", storeId: "org-one", status: "active" },
    { _id: "e-4", name: "林可", employeeNo: "SZ2050", storeId: "org-two", status: "active" },
    { _id: "e-5", name: "旧临时员工", employeeNo: "AUTO-1", storeId: "org-one", status: "active", source: "direct_login" }
  ];

  assert.deepEqual(matchEmployeesByStoreAndName(employees, "org-one", " 林可 "), [employees[0]]);
  assert.deepEqual(matchEmployeesByStoreAndName(employees, "org-one", "林"), []);
  assert.deepEqual(matchEmployeesByStoreAndName(employees, "org-one", "旧临时员工"), []);
  assert.deepEqual(matchEmployeesByStoreAndName(employees, "org-two", "林可"), [employees[3]]);

  assert.throws(
    () => resolveDirectLoginEmployee({
      stores: [{ id: "org-one", name: "示例门店", regionId: "shenzhen" }],
      employees,
      storeId: "org-one",
      employeeName: "陈宇"
    }),
    (error) => error.code === "EMPLOYEE_AMBIGUOUS" && !error.candidates
  );
});

test("direct login rejects employees absent from the headquarters list", () => {
  assert.throws(() => resolveDirectLoginEmployee({
    stores: [{ id: "org-one", name: "示例门店", regionId: "shenzhen" }],
    employees: [],
    storeId: "org-one",
    employeeName: "新员工"
  }), (error) => error.code === "EMPLOYEE_NOT_FOUND" && error.message.includes("总部员工名单") && !error.candidates);
});
