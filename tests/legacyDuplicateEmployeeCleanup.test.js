const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildLegacyDuplicateEmployeeCleanupPlan,
  findRelationCollisions,
  isLegacyManualReviewEmployee,
  sameEmployeeIdSet
} = require("../cloudbase/functions/adminData/legacyDuplicateEmployeeCleanupCore");

const employees = [
  { _id: "formal-rao", name: "饶武云", employeeNo: "JYS-HQ-001", storeId: "hq", role: "admin", status: "active", goldenBeans: 0 },
  { _id: "web-rao", name: " 饶武云 ", employeeNo: "MR-RAO", storeId: "hq", role: "employee", status: "active", goldenBeans: 0 },
  { _id: "formal-li", name: "李店员", employeeNo: "MD-001", storeId: "store-1", role: "employee", status: "active", goldenBeans: 5 },
  { _id: "web-li", name: "李店员", employeeNo: "MR-LI", storeId: "store-1", role: "employee", status: "active", goldenBeans: 6 },
  { _id: "web-no-match", name: "未入册员工", employeeNo: "MR-NO", storeId: "store-2", role: "employee", status: "active", goldenBeans: 0 }
];

test("selects only zero-balance legacy duplicates and protects formal employees", () => {
  const plan = buildLegacyDuplicateEmployeeCleanupPlan({ employees });
  assert.equal(plan.summary.candidateCount, 1);
  assert.equal(plan.summary.protectedWithBalanceCount, 1);
  assert.equal(plan.summary.unsafeCount, 1);
  assert.deepEqual(plan.candidates[0], {
    legacyEmployeeId: "web-rao",
    legacyEmployeeNo: "MR-RAO",
    formalEmployeeId: "formal-rao",
    formalEmployeeNo: "JYS-HQ-001",
    formalRole: "admin",
    name: "饶武云",
    storeId: "hq",
    goldenBeans: 0
  });
  assert.equal(isLegacyManualReviewEmployee(employees[0]), false);
  assert.equal(isLegacyManualReviewEmployee(employees[1]), true);
});

test("allows a cleanup retry for an employee already marked as merging", () => {
  const retryEmployees = employees.map((employee) => (
    employee._id === "web-rao" ? { ...employee, status: "legacy-duplicate-merging" } : employee
  ));
  const plan = buildLegacyDuplicateEmployeeCleanupPlan({ employees: retryEmployees });
  assert.equal(plan.summary.candidateCount, 1);
  assert.equal(plan.candidates[0].legacyEmployeeId, "web-rao");
});

test("requires the committed candidate IDs to equal the dry-run IDs", () => {
  assert.equal(sameEmployeeIdSet(["web-b", "web-a"], ["web-a", "web-b"]), true);
  assert.equal(sameEmployeeIdSet(["web-a"], ["web-a", "web-b"]), false);
  assert.equal(sameEmployeeIdSet(["web-a"], ["web-a", "web-a"]), true);
});

test("detects uniqueness collisions before migrating progress or ledger records", () => {
  const candidates = [{ legacyEmployeeId: "web-rao", formalEmployeeId: "formal-rao" }];
  const collisions = findRelationCollisions({
    candidates,
    recordsByCollection: {
      courseProgress: [
        { _id: "old-course", employeeId: "web-rao", courseId: "course-1" },
        { _id: "new-course", employeeId: "formal-rao", courseId: "course-1" }
      ],
      goldenBeanLedger: [
        { _id: "old-ledger", employeeId: "web-rao", sourceType: "exam", sourceId: "exam-1" },
        { _id: "new-ledger", employeeId: "formal-rao", sourceType: "exam", sourceId: "exam-2" }
      ]
    }
  });
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].collectionName, "courseProgress");
  assert.equal(collisions[0].key, "course-1");
});
