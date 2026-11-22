const assert = require("node:assert/strict");
const test = require("node:test");

async function logoutStateCore() {
  return import("../apps/employee/src/logoutStateCore.js");
}

test("logout marker keeps the employee scan entry and survives a page reload", async () => {
  const { hasLogoutMarker, setLogoutMarker } = await logoutStateCore();

  const search = setLogoutMarker("?entry=scan&storeId=store-1");

  assert.equal(hasLogoutMarker(search), true);
  assert.equal(new URLSearchParams(search).get("entry"), "scan");
  assert.equal(new URLSearchParams(search).get("storeId"), "store-1");
});

test("clearing logout marker preserves other login parameters", async () => {
  const { clearLogoutMarker, setLogoutMarker } = await logoutStateCore();
  const marked = setLogoutMarker("?entry=scan&storeId=store-1");

  const resumed = clearLogoutMarker(marked);

  assert.equal(new URLSearchParams(resumed).has("loggedOut"), false);
  assert.equal(new URLSearchParams(resumed).get("entry"), "scan");
  assert.equal(new URLSearchParams(resumed).get("storeId"), "store-1");
});
