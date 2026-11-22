export function supplierProductKeys(value = "") {
  const items = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
}

export function toggleSupplierProduct(value, product, checked) {
  const key = String(product || "").trim();
  const selected = supplierProductKeys(value);
  if (!key) return selected.join(", ");
  if (checked && !selected.includes(key)) selected.push(key);
  if (!checked) return selected.filter((item) => item !== key).join(", ");
  return selected.join(", ");
}
