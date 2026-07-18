import fs from "node:fs";
import path from "node:path";

const sourcePath = process.argv[2];
const outputPath = process.argv[3];

if (!sourcePath || !outputPath) {
  throw new Error("Usage: node tools/extract-amo-frontend.mjs <Code.js> <amo.html>");
}

const source = fs.readFileSync(sourcePath, "utf8");
const match = source.match(/const DASHBOARD_HTML = ("(?:\\.|[^"\\])*");\s*\r?\n/);
if (!match) throw new Error("DASHBOARD_HTML was not found in the cloned Apps Script source.");

let html = JSON.parse(match[1]);
const originalBase = 'const BASE_URL = "%%BASE_URL%%";';
if (!html.includes(originalBase)) throw new Error("Expected Apps Script base URL placeholder was not found.");

html = html.replace(
  originalBase,
  'const BASE_URL = window.AMO_CONFIG.apiUrl;'
);

if (!html.includes("</head>")) throw new Error("Expected document head was not found.");
html = html.replace(
  "</head>",
  '<script src="./amo-config.js"></script>\n</head>'
);

const syncMessage = '  showToast("Kes direkod. Sync ke Sheet...");';
if (!html.includes(syncMessage)) throw new Error("Expected save flow was not found.");
html = html.replace(
  syncMessage,
  `${syncMessage}\n\n  if(!window.AMO_CONFIG.writeEnabled){\n    showToast("Mod ujian: tiada data dihantar ke Google Sheet");\n    return;\n  }`
);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, html, "utf8");
console.log(`Extracted production frontend to ${outputPath}`);
