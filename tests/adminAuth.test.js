const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertAdminSecret,
  bearerSecret,
  corsOriginForRequest
} = require("../cloudbase/functions/adminData/authCore");

test("rejects missing server configuration and invalid credentials", () => {
  assert.throws(() => assertAdminSecret({ configuredSecret: "", providedSecret: "anything" }), (error) => error.code === "ADMIN_SECRET_REQUIRED");
  assert.throws(() => assertAdminSecret({ configuredSecret: "configured", providedSecret: "" }), (error) => error.code === "ADMIN_UNAUTHORIZED");
  assert.throws(() => assertAdminSecret({ configuredSecret: "configured", providedSecret: "wrong" }), (error) => error.code === "ADMIN_UNAUTHORIZED");
  assert.equal(assertAdminSecret({ configuredSecret: "configured", providedSecret: "configured" }), true);
});

test("reads only a Bearer authorization token", () => {
  assert.equal(bearerSecret("Bearer admin-token"), "admin-token");
  assert.equal(bearerSecret("bearer admin-token"), "admin-token");
  assert.equal(bearerSecret("Basic admin-token"), "");
  assert.equal(bearerSecret(""), "");
});

test("allows configured origins without wildcard fallback", () => {
  const configured = "https://admin.example.com, https://ops.example.com/path";
  assert.equal(corsOriginForRequest("https://admin.example.com", configured), "https://admin.example.com");
  assert.equal(corsOriginForRequest("https://ops.example.com", configured), "https://ops.example.com");
  assert.equal(corsOriginForRequest("https://evil.example.com", configured), "");
  assert.equal(corsOriginForRequest("*", configured), "");
  assert.equal(corsOriginForRequest("https://admin.example.com", "*"), "");
});
