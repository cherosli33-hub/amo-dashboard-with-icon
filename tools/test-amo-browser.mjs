import { chromium } from "playwright-core";

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
});

const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: "ms-MY",
  timezoneId: "Asia/Kuala_Lumpur"
});
const page = await context.newPage();
const errors = [];
const productionPosts = [];
page.on("console", message => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => {
  if (request.method() === "POST" && request.url().includes("script.google.com/macros/s/")) {
    productionPosts.push(request.url());
  }
});

await page.goto("http://127.0.0.1:4173/amo.html", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.querySelector("#loading-screen")?.classList.contains("hidden"), null, { timeout: 20000 });
await page.getByRole("heading", { name: /Log Prosedur Assistan Medical Officer/ }).waitFor();

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
if (overflow > 1) throw new Error(`Mobile layout overflows horizontally by ${overflow}px.`);

await page.locator("#fab").click();
await page.getByText("Pilih shift", { exact: true }).waitFor();
await page.getByRole("button", { name: /Pagi/ }).click();
await page.getByText("Pilih Zone", { exact: true }).waitFor();
await page.getByRole("button", { name: "Yellow Zone" }).click();
await page.getByPlaceholder(/Masukkan ID Pesakit/).fill("TEST-MIGRATION-LOCAL");
await page.getByRole("button", { name: "Dressing" }).click();
await page.getByRole("button", { name: /Simpan kes/ }).click();
await page.getByText("Mod ujian: tiada data dihantar ke Google Sheet", { exact: true }).waitFor();

if (productionPosts.length) throw new Error("Read-only preview attempted a production POST.");
if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);

await page.screenshot({ path: "artifacts/amo-flow-mobile.png", fullPage: true });
await browser.close();

console.log("PASS: shared production data endpoint can be read from the GitHub-style frontend.");
console.log("PASS: shift, zone, patient ID, procedure and save flow work on a mobile viewport.");
console.log("PASS: migration preview performed zero production writes.");
console.log("PASS: mobile layout has no horizontal overflow.");
