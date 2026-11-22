const assert = require("node:assert/strict");
const test = require("node:test");

const {
  HEADQUARTERS_STORE_ID,
  resolveHeadquartersEmployee
} = require("../cloudbase/functions/employeeWeb/headquartersBindingCore");

const employees = [
  { _id: "hq-rao", name: "饶经理", storeId: HEADQUARTERS_STORE_ID, status: "active" },
  { _id: "hq-li", name: "李小勇", storeId: HEADQUARTERS_STORE_ID, status: "active" },
  { _id: "store-li", name: "李小勇", storeId: "org-store", status: "active" },
  { _id: "hq-inactive", name: "离职员工", storeId: HEADQUARTERS_STORE_ID, status: "inactive" }
];

test("headquarters employees bypass review only on an exact active match", () => {
  const match = resolveHeadquartersEmployee({
    employees,
    storeId: HEADQUARTERS_STORE_ID,
    employeeName: "  李小勇  "
  });
  assert.equal(match.employee._id, "hq-li");
  assert.equal(match.isHeadquarters, true);

  const partial = resolveHeadquartersEmployee({
    employees,
    storeId: HEADQUARTERS_STORE_ID,
    employeeName: "小勇"
  });
  assert.equal(partial.employee, null);
  assert.equal(partial.isHeadquarters, true);

  const inactive = resolveHeadquartersEmployee({
    employees,
    storeId: HEADQUARTERS_STORE_ID,
    employeeName: "离职员工"
  });
  assert.equal(inactive.employee, null);
});

test("non-headquarters employees stay on the review path", () => {
  const result = resolveHeadquartersEmployee({
    employees,
    storeId: "org-store",
    employeeName: "李小勇"
  });
  assert.equal(result.isHeadquarters, false);
  assert.equal(result.employee, null);
});

test("duplicate headquarters names block automatic binding", () => {
  assert.throws(() => resolveHeadquartersEmployee({
    employees: [
      ...employees,
      { _id: "hq-li-duplicate", name: "李小勇", storeId: HEADQUARTERS_STORE_ID, status: "active" }
    ],
    storeId: HEADQUARTERS_STORE_ID,
    employeeName: "李小勇"
  }), (error) => error.code === "HEADQUARTERS_EMPLOYEE_AMBIGUOUS");
});
