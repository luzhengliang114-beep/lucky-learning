export function caseUnreadCount(cases, isSupplier = false) {
  if (isSupplier) return 0;
  return (Array.isArray(cases) ? cases : []).filter((item) => (
    item?.status === "approved"
    && item?.acknowledgementRequired === true
    && item?.acknowledgementStatus !== "acknowledged"
  )).length;
}

export function caseUnreadLabel(count) {
  const normalized = Math.max(0, Math.trunc(Number(count) || 0));
  if (!normalized) return "";
  return normalized > 99 ? "99+" : String(normalized);
}
