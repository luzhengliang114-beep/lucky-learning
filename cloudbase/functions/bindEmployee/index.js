const {
  db,
  fail,
  getFirst,
  now,
  ok,
  requireString
} = require("./_shared/db");
const {
  isAllowlistedEmployee,
  resolveAllowlistedEmployee,
  resolveStoreById,
  resolveStoreByName
} = require("./allowlistCore");

function publicEmployee(employee = {}) {
  const { inviteCode, ...safeEmployee } = employee;
  return safeEmployee;
}


exports.main = async (event = {}, context = {}) => {
  try {
    const openId = context.OPENID || event.openId;

    if (!openId) {
      return fail("Missing WeChat openId", "NO_OPENID");
    }

    const existingUser = await getFirst("users", { openId });
    if (existingUser) {
      const existingEmployee = await getFirst("employees", {
        _id: existingUser.employeeId,
        status: "active"
      });
      if (!existingEmployee || !isAllowlistedEmployee(existingEmployee)) {
        return fail("当前微信账号的员工资料不存在，请联系管理员", "EMPLOYEE_ACCOUNT_INVALID");
      }

      if (existingUser.status !== "active") {
        await db.collection("users").doc(existingUser._id).update({
          status: "active",
          updatedAt: now()
        });
      }

      const store = existingEmployee.storeId
        ? await getFirst("stores", { _id: existingEmployee.storeId })
        : null;
      return ok({
        employee: {
          ...publicEmployee(existingEmployee),
          id: existingEmployee._id,
          store: store?.name || ""
        },
        existingAccount: true
      });
    }

    const employeeName = requireString(event.employeeName, "employeeName");
    const [storeResult, employeeResult] = await Promise.all([
      db.collection("stores").limit(1000).get(),
      db.collection("employees").limit(1000).get()
    ]);
    const stores = storeResult.data || [];
    const employees = employeeResult.data || [];
    const store = event.storeId
      ? resolveStoreById(stores, requireString(event.storeId, "storeId"))
      : resolveStoreByName(stores, requireString(event.storeName, "storeName"));
    const storeId = store._id || store.id;
    const employee = resolveAllowlistedEmployee(employees, storeId, employeeName);
    const employeeId = employee._id || employee.id;
    const boundUserResult = await db.collection("users").where({ employeeId, status: "active" }).limit(1).get();
    if ((boundUserResult.data || []).length > 0) {
      return fail("该员工已绑定其他微信，请联系总部管理员解绑", "EMPLOYEE_ALREADY_BOUND");
    }
    await db.collection("users").add({
      openId,
      employeeId,
      role: employee.role || "employee",
      status: "active",
      createdAt: now(),
      updatedAt: now()
    });

    return ok({
      employee: {
        ...publicEmployee(employee),
        store: store.name
      }
    });
  } catch (error) {
    return fail(error.message, "BIND_EMPLOYEE_FAILED");
  }
};
