function text(value) {
  return String(value || "").trim();
}

function productKey(item = {}) {
  return text(item.productKey || item.productId || item.productName || item.title);
}

function existingSupplierProducts(groups = []) {
  return new Set(groups.flat().map(productKey).filter(Boolean));
}

function invalidSupplierProducts(productKeys = [], groups = []) {
  const existing = existingSupplierProducts(groups);
  return productKeys.map(text).filter(Boolean).filter((item) => !existing.has(item));
}

function isEmployeeResetTarget(employee = {}) {
  return employee.status !== "inactive" && text(employee.role) !== "supplier";
}

function findSupplierOrganization(stores = []) {
  return stores.find((item) => item.storeNo === "SUPPLIER" && item.organizationType === "department") || null;
}

function supplierOrganizationRecord(updatedAt, brand) {
  return {
    name: "供应商",
    regionId: "default",
    brandId: brand._id,
    brandName: brand.name,
    storeNo: "SUPPLIER",
    address: "",
    organizationType: "department",
    status: "active",
    createdAt: updatedAt,
    updatedAt
  };
}

module.exports = {
  existingSupplierProducts,
  findSupplierOrganization,
  invalidSupplierProducts,
  isEmployeeResetTarget,
  productKey,
  supplierOrganizationRecord
};
