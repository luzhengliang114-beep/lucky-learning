import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const functionsRoot = join(root, "cloudbase/functions");
const sharedSource = join(functionsRoot, "_shared");
const functionNames = [
  "bindEmployee",
  "completeCourse",
  "submitExam",
  "reviewSubmission",
  "redeemReward",
  "adminAdjustGoldenBeans",
  "adminData",
  "employeeData",
  "employeeWeb",
  "logoutEmployee",
  "miniProgramApi",
  "submitContent",
  "adminReview",
  "employeeReminder"
];

for (const functionName of functionNames) {
  const target = join(functionsRoot, functionName, "_shared");
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
  }
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(sharedSource, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".js")) {
      copyFileSync(join(sharedSource, entry.name), join(target, entry.name));
    }
  }
}

cpSync(
  join(functionsRoot, "miniProgramApi", "contentSecurity.js"),
  join(functionsRoot, "employeeWeb", "contentSecurity.js")
);
cpSync(
  join(functionsRoot, "miniProgramApi", "speech.js"),
  join(functionsRoot, "employeeWeb", "speech.js")
);

console.log(`Prepared shared CloudBase files for ${functionNames.length} functions.`);
