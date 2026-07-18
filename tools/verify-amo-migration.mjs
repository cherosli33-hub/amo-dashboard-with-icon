import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { extractProductionHtml, migrateHtml } from "./extract-amo-frontend.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const sourcePath = process.env.AMO_APPS_SCRIPT_SOURCE || "C:\\Projects\\amo-frontend-github-migration\\Code.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = fs.readFileSync(sourcePath, "utf8");
const productionHtml = extractProductionHtml(source);
const migratedHtml = fs.readFileSync(path.join(repo, "amo.html"), "utf8");
const config = fs.readFileSync(path.join(repo, "amo-config.js"), "utf8");
const portal = fs.readFileSync(path.join(repo, "index.html"), "utf8");
const worker = fs.readFileSync(path.join(repo, "service-worker.js"), "utf8");

assert(migratedHtml === migrateHtml(productionHtml), "amo.html is not the deterministic migration output.");
assert(
  migratedHtml.match(/<style>[\s\S]*?<\/style>/)?.[0] === productionHtml.match(/<style>[\s\S]*?<\/style>/)?.[0],
  "Production visual styles changed during migration."
);
assert(config.includes("writeEnabled: true") && config.includes('environment: "production"'), "Production write configuration is not active.");
assert(migratedHtml.includes("AMO_CASE_CACHE_KEY"), "Local first-paint cache is missing.");
assert(migratedHtml.includes("window.setTimeout(() => loadCases(), 0)"), "Background Sheet refresh is missing.");
assert(portal.includes('href="./amo.html"'), "Production portal does not open the GitHub AMO frontend.");
assert(worker.includes('"./amo.html"') && worker.includes('"./amo-config.js"'), "Preview assets are missing from the service worker.");

const tracked = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).split(/\r?\n/);
assert(!tracked.includes(".clasp.json"), ".clasp.json must never be tracked.");

console.log("PASS: production HTML is visually unchanged.");
console.log("PASS: cached data renders before the background Sheet refresh.");
console.log("PASS: production write configuration is active.");
console.log("PASS: portal opens the GitHub AMO frontend.");
console.log("PASS: .clasp.json is not tracked.");
