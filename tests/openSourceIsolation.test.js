const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const ignoredDirectories = new Set([".git", "node_modules", "dist"]);
const forbiddenDirectories = new Set([".codex-tmp", "artifacts"]);
const forbiddenNames = new Set([".env", ".env.production", "cloudbaserc.json", ".DS_Store"]);
const forbiddenExtensions = new Set([
  ".bak", ".doc", ".docx", ".log", ".mov", ".mp4", ".pdf", ".ppt", ".pptx", ".xls", ".xlsx", ".zip"
]);
const forbiddenPaths = [
  "cloudbase/database/generated",
  "cloudbase/database/source"
];

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
    if (entry.isDirectory()) {
      files.push({ kind: "directory", relativePath, absolutePath });
      walk(absolutePath, files);
    } else if (entry.isFile()) {
      files.push({ kind: "file", relativePath, absolutePath });
    }
  }
  return files;
}

test("open-source snapshot excludes private and generated artifacts", () => {
  const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /^node_modules\/$/m);
  assert.match(gitignore, /^dist\/$/m);
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^cloudbaserc\.json$/m);

  const entries = walk(root);
  const violations = [];

  for (const entry of entries) {
    const basename = path.basename(entry.relativePath);
    const segments = entry.relativePath.split("/");
    if (entry.kind === "directory" && forbiddenDirectories.has(basename)) {
      violations.push(entry.relativePath);
    }
    if (forbiddenPaths.some((prefix) => entry.relativePath === prefix || entry.relativePath.startsWith(`${prefix}/`))) {
      violations.push(entry.relativePath);
    }
    if (entry.kind !== "file") continue;
    if (forbiddenNames.has(basename) || (basename.startsWith(".env.") && basename !== ".env.example")) {
      violations.push(entry.relativePath);
    }
    if (forbiddenExtensions.has(path.extname(basename).toLowerCase()) && entry.relativePath !== "brand/demo/training.mp4") {
      violations.push(entry.relativePath);
    }
    if (segments.includes("public") && fs.statSync(entry.absolutePath).size > 5 * 1024 * 1024) {
      violations.push(`${entry.relativePath} (larger than 5 MB)`);
    }
  }

  assert.deepEqual([...new Set(violations)].sort(), []);
});

test("open-source snapshot contains no credential signatures or production endpoint", () => {
  const credentialPatterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bgh[opusr]_[A-Za-z0-9]{20,}\b/,
    /\bAKID[A-Za-z0-9]{13,}\b/,
    new RegExp(["study", "jianyisheng", "cn"].join("[.]"), "i")
  ];
  const textExtensions = new Set([".cjs", ".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".ts", ".tsx", ".yaml", ".yml"]);
  const violations = [];

  for (const entry of walk(root)) {
    if (entry.kind !== "file" || !textExtensions.has(path.extname(entry.relativePath).toLowerCase())) continue;
    const source = fs.readFileSync(entry.absolutePath, "utf8");
    if (credentialPatterns.some((pattern) => pattern.test(source))) violations.push(entry.relativePath);
  }

  assert.deepEqual(violations.sort(), []);
});
