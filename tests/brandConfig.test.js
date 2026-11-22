const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("brand configuration accepts one company name, logo and color palette", async () => {
  const { normalizeBrandConfig } = await import("../packages/shared/src/brandConfigCore.js");
  const config = normalizeBrandConfig({
    name: "测试企业",
    shortName: "测试企业",
    employeeSubtitle: "员工学习中心",
    adminSubtitle: "员工学习管理后台",
    privacyContact: "管理员联系方式",
    headquartersName: "总部",
    defaultOrganizationId: "",
    logo: "logo.svg",
    favicon: "logo.svg",
    loginBackground: "",
    colors: { primary: "#123456", accent: "#22AA66", progress: "#FFCC00", surface: "#F7F8FA", text: "#172033" },
    features: { speaking: true, rewards: true, ranking: false }
  });
  assert.equal(config.name, "测试企业");
  assert.deepEqual(config.colors, { primary: "#123456", accent: "#22AA66", progress: "#FFCC00", surface: "#F7F8FA", text: "#172033" });
  assert.equal(config.features.ranking, false);
});

test("brand configuration rejects unsafe assets and invalid colors", async () => {
  const { validateBrandConfig } = await import("../packages/shared/src/brandConfigCore.js");
  const errors = validateBrandConfig({
    name: "测试企业",
    shortName: "测试企业",
    employeeSubtitle: "员工学习中心",
    adminSubtitle: "员工学习管理后台",
    privacyContact: "管理员联系方式",
    headquartersName: "总部",
    defaultOrganizationId: "",
    logo: "../secret.svg",
    favicon: "https://example.com/icon.svg",
    colors: { primary: "blue", accent: "#22AA66", progress: "#FFCC00", surface: "#F7F8FA", text: "#172033" },
    features: { speaking: true, rewards: true, ranking: true }
  });
  assert.equal(errors.length, 3);
});

test("brand configuration rejects unknown fields, invalid feature switches and weak button contrast", async () => {
  const { validateBrandConfig } = await import("../packages/shared/src/brandConfigCore.js");
  const errors = validateBrandConfig({
    name: "测试企业",
    shortName: "测试企业",
    employeeSubtitle: "员工学习中心",
    adminSubtitle: "员工学习管理后台",
    privacyContact: "管理员联系方式",
    headquartersName: "总部",
    logo: "logo.svg",
    favicon: "logo.svg",
    colors: { primary: "#FFFF00", accent: "#22AA66", progress: "#FFCC00", surface: "#F7F8FA", text: "#172033", extra: "#000000" },
    features: { speaking: "yes", rewards: true, ranking: true, extra: false },
    unknown: true
  });
  assert.equal(errors.length, 5);
  assert.ok(errors.some((error) => error.includes("4.5:1")));
});

test("invalid primary colors produce field errors rather than crashing validation", async () => {
  const { validateBrandConfig } = await import("../packages/shared/src/brandConfigCore.js");
  const errors = validateBrandConfig({
    name: "测试企业",
    shortName: "测试企业",
    employeeSubtitle: "员工学习中心",
    adminSubtitle: "员工学习管理后台",
    privacyContact: "管理员联系方式",
    headquartersName: "总部",
    logo: "logo.svg",
    favicon: "logo.svg",
    colors: { primary: "not-a-color", accent: "#22AA66", progress: "#FFCC00", surface: "#F7F8FA", text: "#172033" },
    features: { speaking: true, rewards: true, ranking: true }
  });
  assert.ok(errors.some((error) => error.includes("colors.primary")));
});

test("repository brand configuration and assets are valid", async () => {
  const { validateBrandConfig } = await import("../packages/shared/src/brandConfigCore.js");
  const root = path.resolve(__dirname, "..");
  const config = JSON.parse(fs.readFileSync(path.join(root, "config/brand.json"), "utf8"));
  assert.deepEqual(validateBrandConfig(config), []);
  assert.equal(fs.existsSync(path.join(root, "brand", config.logo)), true);
  assert.equal(fs.existsSync(path.join(root, "brand", config.favicon)), true);
});
