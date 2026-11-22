const {
  assertAdmin,
  command,
  db,
  fail,
  getFirst,
  now,
  ok,
  requireString
} = require("./_shared/db");

exports.main = async (event = {}, context = {}) => {
  try {
    const openId = context.OPENID || event.openId;
    const employeeId = requireString(event.employeeId, "employeeId");
    const reason = requireString(event.reason, "reason");
    const delta = Number(event.delta);

    if (!Number.isFinite(delta) || delta === 0) {
      return fail("delta must be a non-zero number", "INVALID_DELTA");
    }

    const admin = await assertAdmin(openId);
    const employee = await getFirst("employees", { _id: employeeId, status: "active" });
    if (!employee) {
      return fail("Employee not found", "EMPLOYEE_NOT_FOUND");
    }

    await db.collection("employees").doc(employeeId).update({
      goldenBeans: command.inc(delta)
    });
    const ledgerResult = await db.collection("goldenBeanLedger").add({
      employeeId,
      sourceType: "manual",
      sourceId: `manual-${Date.now()}`,
      delta,
      reason,
      createdBy: admin._id,
      createdAt: now()
    });

    return ok({
      ledgerId: ledgerResult.id,
      delta
    });
  } catch (error) {
    return fail(error.message, "ADMIN_ADJUST_GOLDEN_BEANS_FAILED");
  }
};
