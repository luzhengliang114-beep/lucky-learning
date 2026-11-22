import fs from "node:fs";

import { validateReleaseConfig } from "./release-config-core.mjs";

const configPath = new URL("../cloudbaserc.json", import.meta.url);
const cloudbaseConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
const result = validateReleaseConfig({ env: process.env, cloudbaseConfig });

console.log(`目标 CloudBase 环境：${result.targetEnvId || "未配置"}`);
if (result.missing.length) console.error(`缺少配置：${result.missing.join(", ")}`);
if (result.invalid.length) console.error(`无效配置：${result.invalid.join(", ")}`);
if (!result.ok) process.exitCode = 1;
else console.log("发布配置检查通过。未输出任何密钥值。");
