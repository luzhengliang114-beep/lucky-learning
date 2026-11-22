const cloudbase = require("@cloudbase/node-sdk");
const { ledgerEntryMatchesProduct } = require("./rewardRules");

const app = cloudbase.init({
  env: cloudbase.SYMBOL_CURRENT_ENV
});

const db = app.database();
const command = db.command;

function ok(data = {}) {
  return {
    ok: true,
    data
  };
}

function fail(message, code = "BAD_REQUEST", extra = {}) {
  return {
    ok: false,
    code,
    message,
    ...extra
  };
}

function now() {
  return new Date().toISOString();
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

async function getFirst(collectionName, filter) {
  const result = await db.collection(collectionName).where(filter).limit(1).get();
  return result.data && result.data.length > 0 ? result.data[0] : null;
}

async function addGoldenBeansOnce({
  employeeId,
  sourceType,
  sourceId,
  productKey = "",
  delta,
  reason,
  createdBy = "system"
}) {
  const ledger = {
    employeeId,
    sourceType,
    sourceId,
    ...(productKey ? { productKey } : {}),
    delta,
    reason,
    createdBy,
    createdAt: now()
  };

  return db.runTransaction(async (transaction) => {
    const existingResult = await transaction.collection("goldenBeanLedger").where({
      employeeId,
      sourceType,
      sourceId
    }).limit(1).get();
    const existing = existingResult.data?.[0];
    if (existing) {
      return {
        awarded: false,
        ledger: existing
      };
    }

    const addResult = await transaction.collection("goldenBeanLedger").add(ledger);
    await transaction.collection("employees").doc(employeeId).update({
      goldenBeans: command.inc(delta)
    });

    return {
      awarded: true,
      ledger: {
        _id: addResult.id,
        ...ledger
      }
    };
  });
}

async function getProductRewardTotal(employeeId, productKey) {
  if (!employeeId || !productKey) {
    return 0;
  }

  const [ledgerResult, coursesResult, examsResult, phrasesResult] = await Promise.all([
    db.collection("goldenBeanLedger").where({ employeeId }).limit(1000).get(),
    db.collection("courses").limit(1000).get(),
    db.collection("exams").limit(1000).get(),
    db.collection("phrases").limit(1000).get()
  ]);
  const productSourceIds = [coursesResult, examsResult, phrasesResult]
    .flatMap((result) => result.data || [])
    .filter((item) => (item.productId || item.productName || item.productKey) === productKey)
    .map((item) => item._id || item.id)
    .filter(Boolean);

  return (ledgerResult.data || [])
    .filter((entry) => (
      Number(entry.delta || 0) > 0
      && ledgerEntryMatchesProduct(entry, productKey, productSourceIds)
    ))
    .reduce((total, entry) => total + Number(entry.delta || 0), 0);
}

async function addCappedGoldenBeans({
  employeeId,
  sourceType,
  sourceId,
  productKey,
  delta,
  reason,
  createdBy = "system",
  productCap = 50,
  categoryCap = null,
  categorySourceType = sourceType
}) {
  const requestedDelta = Math.max(0, Number(delta || 0));
  if (requestedDelta <= 0) {
    return { awarded: false, delta: 0, capped: false, remaining: 0 };
  }

  const existing = await getFirst("goldenBeanLedger", { employeeId, sourceType, sourceId });
  if (existing) {
    return { awarded: false, delta: 0, capped: false, remaining: 0, ledger: existing };
  }

  const productTotal = await getProductRewardTotal(employeeId, productKey);
  const productRemaining = Math.max(0, Number(productCap || 0) - productTotal);
  let categoryRemaining = Number.POSITIVE_INFINITY;

  if (categoryCap !== null && categoryCap !== undefined) {
    const result = await db.collection("goldenBeanLedger").where({
      employeeId,
      productKey,
      sourceType: categorySourceType
    }).limit(1000).get();
    const categoryTotal = (result.data || [])
      .filter((entry) => Number(entry.delta || 0) > 0)
      .reduce((total, entry) => total + Number(entry.delta || 0), 0);
    categoryRemaining = Math.max(0, Number(categoryCap || 0) - categoryTotal);
  }

  const awardDelta = Math.min(requestedDelta, productRemaining, categoryRemaining);
  if (awardDelta <= 0) {
    return {
      awarded: false,
      delta: 0,
      capped: true,
      remaining: Math.max(0, Math.min(productRemaining, categoryRemaining))
    };
  }

  const award = await addGoldenBeansOnce({
    employeeId,
    sourceType,
    sourceId,
    productKey,
    delta: awardDelta,
    reason,
    createdBy
  });
  return {
    ...award,
    delta: awardDelta,
    capped: awardDelta < requestedDelta,
    remaining: Math.max(0, Math.min(productRemaining, categoryRemaining) - awardDelta)
  };
}

async function assertAdmin(openId) {
  const user = await getFirst("users", {
    openId,
    role: "admin",
    status: "active"
  });

  if (!user) {
    throw new Error("Admin permission required");
  }

  return user;
}

module.exports = {
  addCappedGoldenBeans,
  addGoldenBeansOnce,
  app,
  assertAdmin,
  command,
  db,
  fail,
  getProductRewardTotal,
  getFirst,
  now,
  ok,
  requireString
};
