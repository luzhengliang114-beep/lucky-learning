const HEX_COLOR = /^#[0-9A-F]{6}$/i;
const SAFE_ASSET = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const FEATURE_KEYS = new Set(["speaking", "rewards", "ranking"]);
const TOP_LEVEL_KEYS = new Set([
  "name",
  "shortName",
  "employeeSubtitle",
  "adminSubtitle",
  "privacyContact",
  "headquartersName",
  "defaultOrganizationId",
  "logo",
  "favicon",
  "loginBackground",
  "colors",
  "features"
]);
const COLOR_KEYS = new Set(["primary", "accent", "progress", "surface", "text"]);

function text(value) {
  return String(value || "").trim();
}

function color(value) {
  return text(value).toUpperCase();
}

function validAssetPath(value) {
  const normalized = text(value);
  return Boolean(normalized)
    && SAFE_ASSET.test(normalized)
    && !normalized.startsWith("/")
    && !normalized.split("/").includes("..");
}

function relativeLuminance(value) {
  const channels = value.slice(1).match(/.{2}/g).map((channel) => Number.parseInt(channel, 16) / 255);
  const linear = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrastRatio(first, second) {
  const light = Math.max(relativeLuminance(first), relativeLuminance(second));
  const dark = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (light + 0.05) / (dark + 0.05);
}

export function validateBrandConfig(input) {
  const value = input && typeof input === "object" ? input : {};
  const colors = value.colors && typeof value.colors === "object" ? value.colors : {};
  const features = value.features && typeof value.features === "object" ? value.features : {};
  const errors = [];

  for (const field of Object.keys(value)) {
    if (!TOP_LEVEL_KEYS.has(field)) errors.push(`${field} 不是支持的品牌配置字段`);
  }

  for (const field of ["name", "shortName", "employeeSubtitle", "adminSubtitle", "privacyContact", "headquartersName"]) {
    if (!text(value[field])) errors.push(`${field} 不能为空`);
  }
  for (const field of ["logo", "favicon"]) {
    if (!validAssetPath(value[field])) errors.push(`${field} 必须是 brand 目录内的相对路径`);
  }
  if (value.loginBackground !== undefined && value.loginBackground !== "" && !validAssetPath(value.loginBackground)) {
    errors.push("loginBackground 必须是 brand 目录内的相对路径或空值");
  }
  for (const field of ["primary", "accent", "progress", "surface", "text"]) {
    if (!HEX_COLOR.test(text(colors[field]))) errors.push(`colors.${field} 必须是六位十六进制色值`);
  }
  for (const field of Object.keys(colors)) {
    if (!COLOR_KEYS.has(field)) errors.push(`colors.${field} 不是支持的颜色字段`);
  }
  for (const field of Object.keys(features)) {
    if (!FEATURE_KEYS.has(field)) errors.push(`features.${field} 不是支持的功能开关`);
    else if (typeof features[field] !== "boolean") errors.push(`features.${field} 必须是布尔值`);
  }
  for (const field of FEATURE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(features, field)) errors.push(`features.${field} 必须配置`);
  }
  if (HEX_COLOR.test(text(colors.primary))
    && contrastRatio(color(colors.primary), "#FFFFFF") < 4.5) {
    errors.push("主色与白色按钮文字的对比度必须至少为 4.5:1");
  }
  if (HEX_COLOR.test(text(colors.surface)) && HEX_COLOR.test(text(colors.text))
    && contrastRatio(color(colors.surface), color(colors.text)) < 4.5) {
    errors.push("页面底色与正文色的对比度必须至少为 4.5:1");
  }
  return errors;
}

export function normalizeBrandConfig(input) {
  const errors = validateBrandConfig(input);
  if (errors.length) throw new Error(`品牌配置无效：${errors.join("；")}`);
  const features = input.features && typeof input.features === "object" ? input.features : {};
  return {
    name: text(input.name),
    shortName: text(input.shortName),
    employeeSubtitle: text(input.employeeSubtitle),
    adminSubtitle: text(input.adminSubtitle),
    privacyContact: text(input.privacyContact),
    headquartersName: text(input.headquartersName),
    defaultOrganizationId: text(input.defaultOrganizationId),
    logo: text(input.logo),
    favicon: text(input.favicon),
    loginBackground: text(input.loginBackground),
    colors: {
      primary: color(input.colors.primary),
      accent: color(input.colors.accent),
      progress: color(input.colors.progress),
      surface: color(input.colors.surface),
      text: color(input.colors.text)
    },
    features: {
      speaking: features.speaking === true,
      rewards: features.rewards === true,
      ranking: features.ranking === true
    }
  };
}

export function joinBrandAssetUrl(baseUrl, assetPath) {
  const base = `${String(baseUrl || "/").replace(/\/+$/, "")}/`;
  return `${base}${String(assetPath || "").replace(/^\/+/, "")}`;
}
