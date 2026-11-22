function text(value) {
  return String(value || "").trim();
}

function normalizeReceiptText(value) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000，。！？；：、,.!?;:'"“”‘’（）()\[\]{}<>《》]/g, "");
}

function normalizeReceiptProductName(value, aliases = {}) {
  const normalized = normalizeReceiptText(value);
  if (!normalized) return "";
  const entries = Object.entries(aliases || {})
    .map(([key, values]) => [key, [key, ...(Array.isArray(values) ? values : [values])].map(normalizeReceiptText)])
    .sort((left, right) => right[1].join("").length - left[1].join("").length);
  for (const [productKey, names] of entries) {
    if (names.some((name) => name && normalized.includes(name))) return text(productKey);
  }
  return "";
}

function canCountStoreReceipt({ employee = {}, store = {} } = {}) {
  const employeeStoreId = text(employee.storeId);
  const resolvedStoreId = text(store.id || store._id || store.storeId);
  return employee.status !== "inactive"
    && employee.role !== "admin"
    && employee.role !== "supplier"
    && Boolean(employeeStoreId && resolvedStoreId && employeeStoreId === resolvedStoreId)
    && store.status !== "inactive"
    && text(store.organizationType || "store") !== "department";
}

function receiptFingerprint({ imageSha256, receiptNo, storeId, saleDate, productKey, quantity } = {}) {
  const image = text(imageSha256);
  if (image) return `image:${image}`;
  const fallback = [storeId, receiptNo, saleDate, productKey, quantity].map(text).join("|").toLowerCase();
  return fallback === "||||" ? "" : `fields:${fallback}`;
}

function parseReceiptFields(lines = [], productAliases = {}) {
  const textLines = lines.map(text).filter(Boolean);
  const joined = textLines.join(" ");
  const productKey = normalizeReceiptProductName(joined, productAliases);
  const storeName = textLines.find((line) => /药房|药店|门店|分店/.test(line)) || "";
  const receiptNo = (joined.match(/(?:销售单号|小票号|单号|流水号)\s*[:：#]?\s*([A-Z0-9-]{6,})/i) || [])[1] || ((joined.match(/\b\d{12,}\b/) || [])[0] || "");
  const date = (joined.match(/(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/) || [])[1] || "";
  let quantity = 0;
  const productIndex = textLines.findIndex((line) => normalizeReceiptProductName(line, productAliases));
  // OCR often splits a product row into separate columns. Inspect the row and
  // the following two rows, then fall back to labeled quantity fields anywhere
  // in the receipt while deliberately ignoring price/amount labels.
  const candidate = productIndex >= 0 ? textLines.slice(productIndex, productIndex + 3).join(" ") : joined;
  quantity = parseReceiptQuantity(
    (candidate.match(/(?:数量|数|件数|qty|x|×)\s*[:：]?\s*(\d+)/i) || [])[1]
      || ((candidate.match(/(?:^|\s)(\d+)\s*(?:盒|瓶|支)\b/i) || [])[1] || "")
  );
  if (!quantity) {
    const quantityLine = textLines.find((line) => /(?:数量|数|件数|qty)\s*[:：]?\s*\d+/i.test(line));
    quantity = parseReceiptQuantity((quantityLine?.match(/(?:数量|数|件数|qty)\s*[:：]?\s*(\d+)/i) || [])[1] || "");
  }
  if (!quantity && productIndex >= 0) {
    const following = textLines.slice(productIndex + 1, productIndex + 3);
    const standalone = following.find((line) => /^\s*\d+\s*$/.test(line));
    quantity = parseReceiptQuantity(standalone || "");
  }
  return { storeName, productKey, receiptNo, saleDate: date, quantity };
}

function parseReceiptQuantity(value) {
  const quantity = Number(String(value ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isInteger(quantity) && quantity > 0 ? quantity : 0;
}

function normalizeReceiptResult({ employeeId, storeId, storeName, productKey, receiptNo, saleDate, quantity, confidence, imageFileId, imageSha256, source = "tencent-ocr", now = new Date().toISOString() } = {}) {
  const completedQuantity = parseReceiptQuantity(quantity);
  const normalizedProductKey = text(productKey);
  const fingerprint = receiptFingerprint({ imageSha256, receiptNo, storeId, saleDate, productKey: normalizedProductKey, quantity: completedQuantity });
  const numericConfidence = Number(confidence);
  const status = normalizedProductKey && completedQuantity > 0 && fingerprint && (!Number.isFinite(numericConfidence) || numericConfidence >= 0.85) ? "approved" : "review";
  return {
    employeeId: text(employeeId),
    storeId: text(storeId),
    storeName: text(storeName),
    productKey: normalizedProductKey,
    receiptNo: text(receiptNo),
    saleDate: text(saleDate),
    quantity: completedQuantity,
    confidence: Number.isFinite(numericConfidence) ? numericConfidence : 0,
    imageFileId: text(imageFileId),
    imageSha256: text(imageSha256),
    fingerprint,
    source: text(source) || "tencent-ocr",
    status,
    createdAt: now,
    updatedAt: now
  };
}

function mergeReceiptQuantity({ existing = [], receipt } = {}) {
  const fingerprint = text(receipt?.fingerprint);
  if (!fingerprint || existing.some((item) => text(item.fingerprint) === fingerprint && item.status !== "rejected")) {
    return { duplicate: true, addedQuantity: 0, receipts: existing };
  }
  const next = [...existing, receipt];
  const addedQuantity = receipt.status === "approved" ? Number(receipt.quantity || 0) : 0;
  return { duplicate: false, addedQuantity, receipts: next };
}

module.exports = {
  canCountStoreReceipt,
  mergeReceiptQuantity,
  normalizeReceiptProductName,
  normalizeReceiptResult,
  normalizeReceiptText,
  parseReceiptQuantity,
  receiptFingerprint,
  parseReceiptFields
};
