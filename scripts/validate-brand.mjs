import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBrandConfig } from "../packages/shared/src/brandConfigCore.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configFlagIndex = process.argv.indexOf("--config");
const requested = configFlagIndex >= 0 ? process.argv[configFlagIndex + 1] : (process.argv[2] || "config/brand.json");
if (!requested || requested.startsWith("--")) {
  console.error("用法：npm run brand:validate -- --config config/brand.json");
  process.exitCode = 1;
}
const configPath = path.resolve(root, requested);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const errors = validateBrandConfig(config);

for (const assetField of ["logo", "favicon"]) {
  const assetPath = path.resolve(root, "brand", String(config[assetField] || ""));
  if (!assetPath.startsWith(path.resolve(root, "brand") + path.sep) || !fs.existsSync(assetPath)) {
    errors.push(`${assetField} 对应文件不存在`);
  }
}
if (config.loginBackground) {
  const assetPath = path.resolve(root, "brand", String(config.loginBackground));
  if (!assetPath.startsWith(path.resolve(root, "brand") + path.sep) || !fs.existsSync(assetPath)) {
    errors.push("loginBackground 对应文件不存在");
  }
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Brand configuration is valid: ${config.name}`);
}
