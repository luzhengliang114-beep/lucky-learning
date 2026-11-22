import { strToU8, zipSync } from "fflate";
import base from "../../../config/brand.json";
import defaultLogo from "../../../brand/logo.svg?url";
import { normalizeBrandConfig } from "../../../packages/shared/src/brandConfigCore.js";
import { logoExtension } from "./logo.js";
import "./styles.css";

const form = document.querySelector("#brand-form");
const nameInput = document.querySelector("#company-name");
const logoInput = document.querySelector("#logo-file");
const fileNote = document.querySelector("#file-note");
const palette = document.querySelector("#palette");
const status = document.querySelector("#status");
const previews = document.querySelector(".previews");
const exportButton = form.querySelector("button[type='submit']");
const colors = new Map();
let logo;
let logoError = "";
let fileRevision = 0;
let logoPending = false;

const labels = {
  primary: "主色",
  accent: "强调色",
  progress: "进度色",
  surface: "页面底色",
  text: "正文色"
};

nameInput.placeholder = base.name;
for (const [key, label] of Object.entries(labels)) {
  const field = document.createElement("label");
  const name = document.createElement("span");
  const code = document.createElement("output");
  const input = document.createElement("input");
  name.textContent = label;
  input.type = "color";
  input.value = base.colors[key];
  input.setAttribute("aria-label", label);
  field.append(name, input, code);
  palette.append(field);
  colors.set(key, { input, code });
}

function render() {
  const name = nameInput.value.trim().replace(/\s+/g, " ");
  const palette = {};
  for (const [key, { input, code }] of colors) {
    palette[key] = input.value.toUpperCase();
    code.value = palette[key];
    previews.style.setProperty(`--preview-${key}`, palette[key]);
  }
  for (const label of previews.querySelectorAll("[data-company]")) label.textContent = name || base.name;
  for (const image of previews.querySelectorAll("[data-logo]")) image.src = logo?.url || defaultLogo;

  const config = {
    ...base,
    name: name || base.name,
    shortName: name || base.shortName,
    colors: palette
  };
  if (logo) config.logo = config.favicon = logo.path;
  try {
    const result = normalizeBrandConfig(config);
    status.textContent = logoError || (logoPending ? "正在读取 Logo…" : "");
    exportButton.disabled = Boolean(logoError || logoPending);
    return result;
  } catch (error) {
    status.textContent = logoError || error.message;
    exportButton.disabled = true;
  }
}

form.addEventListener("input", (event) => {
  if (event.target !== logoInput) render();
});
logoInput.addEventListener("change", async () => {
  const revision = ++fileRevision;
  const file = logoInput.files[0];
  if (logo) URL.revokeObjectURL(logo.url);
  logo = undefined;
  logoError = "";
  logoPending = Boolean(file);
  fileNote.textContent = "PNG、JPEG 或 WebP，最大 2 MB";
  render();
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error("Logo 不能超过 2 MB");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = logoExtension(bytes);
    if (!extension) throw new Error("请选择有效的 PNG、JPEG 或 WebP 图片");
    const image = await createImageBitmap(file).catch(() => null);
    if (!image) throw new Error("无法读取图片，请重新导出 Logo");
    image.close();
    if (revision !== fileRevision) return;
    logo = { path: `logo-custom.${extension}`, bytes, url: URL.createObjectURL(file) };
    fileNote.textContent = file.name;
  } catch (error) {
    if (revision === fileRevision) logoError = error.message;
  } finally {
    if (revision === fileRevision) {
      logoPending = false;
      render();
    }
  }
});
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const config = render();
  if (!config || logoError || logoPending) return;
  const files = { "config/brand.json": strToU8(`${JSON.stringify(config, null, 2)}\n`) };
  if (logo) files[`brand/${logo.path}`] = logo.bytes;
  const url = URL.createObjectURL(new Blob([zipSync(files)], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "training-brand.zip";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = "品牌配置已导出";
});

render();
