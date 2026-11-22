const {
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
    const rewardId = requireString(event.rewardId, "rewardId");

    if (!openId) {
      return fail("Missing WeChat openId", "NO_OPENID");
    }

    const user = await getFirst("users", { openId, status: "active" });
    if (!user) {
      return fail("User is not bound to an employee", "USER_NOT_BOUND");
    }

    const employee = await getFirst("employees", { _id: user.employeeId, status: "active" });
    const reward = await getFirst("rewards", { _id: rewardId, status: "active" });

    if (!employee || !reward) {
      return fail("Employee or reward not found", "NOT_FOUND");
    }

    const cost = Number(reward.goldenBeanPrice || 0);
    if (Number(employee.goldenBeans || 0) < cost) {
      return fail("Not enough Golden Beans", "INSUFFICIENT_GOLDEN_BEANS");
    }
    if (Number(reward.stock || 0) <= 0) {
      return fail("Reward is out of stock", "OUT_OF_STOCK");
    }

    await db.collection("employees").doc(employee._id).update({
      goldenBeans: command.inc(-cost)
    });
    await db.collection("rewards").doc(reward._id).update({
      stock: command.inc(-1)
    });
    await db.collection("goldenBeanLedger").add({
      employeeId: employee._id,
      sourceType: "redemption",
      sourceId: reward._id,
      delta: -cost,
      reason: `兑换奖励：${reward.title}`,
      createdBy: employee._id,
      createdAt: now()
    });
    const redemptionResult = await db.collection("redemptions").add({
      employeeId: employee._id,
      rewardId: reward._id,
      goldenBeanCost: cost,
      status: "pending",
      createdAt: now()
    });

    return ok({
      redemptionId: redemptionResult.id,
      goldenBeanCost: cost
    });
  } catch (error) {
    return fail(error.message, "REDEEM_REWARD_FAILED");
  }
};
