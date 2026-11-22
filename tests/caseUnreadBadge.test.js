const test = require("node:test");
const assert = require("node:assert/strict");

async function unreadCore() {
  return import("../apps/employee/src/caseUnreadCore.js");
}

test("案例未接收数只包含已发布且要求本人确认的内容", async () => {
  const { caseUnreadCount } = await unreadCore();
  const cases = [
    { id: "case-1", status: "approved", acknowledgementRequired: true, acknowledgementStatus: "pending" },
    { id: "case-2", status: "approved", acknowledgementRequired: true, acknowledgementStatus: "acknowledged" },
    { id: "case-3", status: "approved", acknowledgementRequired: false },
    { id: "case-4", status: "pending", acknowledgementRequired: true, acknowledgementStatus: "pending" }
  ];

  assert.equal(caseUnreadCount(cases), 1);
});

test("供应商不显示案例未接收角标", async () => {
  const { caseUnreadCount } = await unreadCore();
  assert.equal(caseUnreadCount([{ status: "approved", acknowledgementRequired: true, acknowledgementStatus: "pending" }], true), 0);
});

test("案例角标超过 99 时显示 99+", async () => {
  const { caseUnreadLabel } = await unreadCore();
  assert.equal(caseUnreadLabel(0), "");
  assert.equal(caseUnreadLabel(8), "8");
  assert.equal(caseUnreadLabel(100), "99+");
});
