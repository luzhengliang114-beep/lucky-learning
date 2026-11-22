const {
  db,
  fail,
  getFirst,
  now,
  ok
} = require("./_shared/db");

exports.main = async (event = {}, context = {}) => {
  try {
    const openId = context.OPENID || event.openId;
    if (!openId) {
      return fail("Missing WeChat openId", "NO_OPENID");
    }

    const existingUser = await getFirst("users", { openId, status: "active" });
    if (existingUser) {
      await db.collection("users").doc(existingUser._id).update({
        status: "inactive",
        updatedAt: now()
      });
    }

    return ok({ bound: false });
  } catch (error) {
    return fail(error.message, "LOGOUT_EMPLOYEE_FAILED");
  }
};
