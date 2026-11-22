import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const seedRoot = join(root, "cloudbase/database/seed");
const outputDir = join(root, "cloudbase/database/generated");
const outputFile = join(outputDir, "seed-command.json");
const collections = ["brands", "regions", "stores"];
const brand = JSON.parse(readFileSync(join(root, "config/brand.json"), "utf8"));

const commands = collections.map((collectionName) => {
  const documents = JSON.parse(readFileSync(join(seedRoot, `${collectionName}.json`), "utf8"));
  if (!(documents.length > 0)) return null;
  if (collectionName === "brands") documents.forEach((document) => { document.name = brand.name; });
  if (collectionName === "stores") documents.forEach((document) => { document.brandName = brand.name; });
  return {
    TableName: collectionName,
    CommandType: "INSERT",
    Command: JSON.stringify({
      insert: collectionName,
      documents
    })
  };
}).filter((command) => command !== null);

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputFile, `${JSON.stringify(commands, null, 2)}\n`);

console.log(`Wrote ${outputFile}`);
console.log("Review the generated command before importing organization data into CloudBase.");
