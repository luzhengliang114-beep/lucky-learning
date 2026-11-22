import rawBrandConfig from "../../../config/brand.json";
import { joinBrandAssetUrl, normalizeBrandConfig } from "./brandConfigCore.js";
import type { BrandConfig } from "./brandConfigCore.js";

export const brandConfig: BrandConfig = normalizeBrandConfig(rawBrandConfig);

export function brandAssetUrl(assetPath: string, baseUrl = import.meta.env.BASE_URL) {
  return joinBrandAssetUrl(baseUrl, assetPath);
}

export function applyBrandToDocument(surface: "employee" | "admin") {
  const root = document.documentElement;
  root.style.setProperty("--brand-primary", brandConfig.colors.primary);
  root.style.setProperty("--brand-accent", brandConfig.colors.accent);
  root.style.setProperty("--brand-progress", brandConfig.colors.progress);
  root.style.setProperty("--brand-surface", brandConfig.colors.surface);
  root.style.setProperty("--brand-text", brandConfig.colors.text);
  root.style.setProperty("--brand-blue", brandConfig.colors.primary);
  root.style.setProperty("--brand-green", brandConfig.colors.accent);
  root.style.setProperty("--brand-yellow", brandConfig.colors.progress);

  document.title = surface === "admin"
    ? `${brandConfig.name}${brandConfig.adminSubtitle}`
    : `${brandConfig.name}｜${brandConfig.employeeSubtitle}`;

  const themeColor = document.querySelector('meta[name="theme-color"]');
  themeColor?.setAttribute("content", brandConfig.colors.primary);
  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (favicon) favicon.href = brandAssetUrl(brandConfig.favicon);
}
