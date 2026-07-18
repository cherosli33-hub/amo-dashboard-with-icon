import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repo = path.resolve(import.meta.dirname, "..");
const sourcePath = process.env.AMO_APPS_SCRIPT_SOURCE || "C:\\Projects\\amo-frontend-github-migration\\Code.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = fs.readFileSync(sourcePath, "utf8");
const sourceMatch = source.match(/const DASHBOARD_HTML = ("(?:\\.|[^"\\])*");\s*\r?\n/);
assert(sourceMatch, "Production DASHBOARD_HTML was not found.");
const productionHtml = JSON.parse(sourceMatch[1]);
const migratedHtml = fs.readFileSync(path.join(repo, "amo.html"), "utf8");
const config = fs.readFileSync(path.join(repo, "amo-config.js"), "utf8");
const portal = fs.readFileSync(path.join(repo, "index.html"), "utf8");
const worker = fs.readFileSync(path.join(repo, "service-worker.js"), "utf8");

const restored = migratedHtml
  .replace('<script src="./amo-config.js"></script>\n', "")
  .replace('const BASE_URL = window.AMO_CONFIG.apiUrl;', 'const BASE_URL = "%%BASE_URL%%";')
  .replace(
    '\n\n  if(!window.AMO_CONFIG.writeEnabled){\n    showToast("Mod ujian: tiada data dihantar ke Google Sheet");\n    return;\n  }',
    ""
  );

assert(restored === productionHtml, "Migrated HTML contains changes beyond the approved transport safeguards.");
assert(config.includes("writeEnabled: false"), "Migration preview must remain read-only.");
assert(!portal.includes('href="./amo.html"'), "Production portal link was changed before approval.");
assert(portal.includes("script.google.com/macros/s/"), "Existing Apps Script portal link is missing.");
assert(worker.includes('"./amo.html"') && worker.includes('"./amo-config.js"'), "Preview assets are missing from the service worker.");

const tracked = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).split(/\r?\n/);
assert(!tracked.includes(".clasp.json"), ".clasp.json must never be tracked.");

console.log("PASS: production HTML is visually unchanged.");
console.log("PASS: migration preview is read-only.");
console.log("PASS: existing user portal still opens Apps Script production.");
console.log("PASS: .clasp.json is not tracked.");

