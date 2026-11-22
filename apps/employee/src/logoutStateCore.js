function paramsFrom(search) {
  return new URLSearchParams(String(search || "").replace(/^\?/, ""));
}

function searchFrom(params) {
  const value = params.toString();
  return value ? `?${value}` : "";
}

export function hasLogoutMarker(search) {
  return paramsFrom(search).get("loggedOut") === "1";
}

export function setLogoutMarker(search) {
  const params = paramsFrom(search);
  params.set("loggedOut", "1");
  return searchFrom(params);
}

export function clearLogoutMarker(search) {
  const params = paramsFrom(search);
  params.delete("loggedOut");
  return searchFrom(params);
}
