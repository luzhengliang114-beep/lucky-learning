export function resolveLoginEntry(search) {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const entry = params.get("entry");
  return {
    mode: entry === "direct" ? "direct" : "oauth",
    storeId: entry === "scan" || entry === "direct" ? params.get("storeId") || "" : ""
  };
}
