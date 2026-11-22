const assert = require("node:assert/strict");
const test = require("node:test");

const {
  EMPLOYEE_NOTICE_VERSION,
  buildEmployeeApplication,
  resolveRegistrationStore
} = require("../cloudbase/functions/employeeWeb/employeeRegistrationCore");

const stores = [
  { _id: "org-one", name: "示例门店", regionId: "shenzhen", status: "active", organizationType: "store" },
  { _id: "org-dept", name: "电子商务", regionId: "shenzhen", status: "active", organizationType: "department" },
  { _id: "org-off", name: "停用店", regionId: "shenzhen", status: "inactive", organizationType: "store" }
];

test("creates a pending application instead of an active employee", () => {
  const store = resolveRegistrationStore(stores, "org-dept");
  const application = buildEmployeeApplication({
    openIdHash: "identity-hash-one",
    store,
    employeeName: "  张三  ",
    noticeVersion: EMPLOYEE_NOTICE_VERSION,
    now: () => "2026-07-30T08:00:00.000Z"
  });

  assert.equal(application.employeeName, "张三");
  assert.equal(application.storeId, "org-dept");
  assert.equal(application.regionId, "shenzhen");
  assert.equal(application.status, "pending");
  assert.equal("role" in application, false);
  assert.equal("goldenBeans" in application, false);
});

test("rejects invalid organizations and blank employee names", () => {
  assert.throws(() => resolveRegistrationStore(stores, "missing"), (error) => error.code === "ORGANIZATION_NOT_FOUND");
  assert.throws(() => resolveRegistrationStore(stores, "org-off"), (error) => error.code === "ORGANIZATION_NOT_FOUND");
  assert.throws(
    () => buildEmployeeApplication({ openIdHash: "identity-hash-one", store: stores[0], employeeName: " ", noticeVersion: EMPLOYEE_NOTICE_VERSION }),
    (error) => error.code === "EMPLOYEE_NAME_REQUIRED"
  );
});
