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
await context.addInitScript(() => {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  localStorage.setItem("amo-procedure-cases-v1", JSON.stringify([{
    id: "cached-first-paint",
    date,
    time: "00:01",
    shift: "morning",
    zone: "yellow_zone",
    registrationNumber: "CACHE-TEST",
    procedures: [{ name: "Dressing", minutes: 15, durationLabel: "15 minit" }]
  }]));
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
await page.route("**/exec*", async route => {
  const request = route.request();
  if (request.method() === "GET" && request.url().includes("action=data")) {
    await new Promise(resolve => setTimeout(resolve, 2200));
  }
  await route.continue();
});

const startedAt = Date.now();
await page.goto("http://127.0.0.1:4173/amo.html", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.querySelector("#loading-screen")?.classList.contains("hidden"), null, { timeout: 20000 });
await page.getByRole("heading", { name: /Log Prosedur Assistan Medical Officer/ }).waitFor();
const firstPaintMs = Date.now() - startedAt;
const cachedCount = (await page.locator(".ring-center .num").textContent())?.trim();
if (cachedCount !== "1") throw new Error(`Cached dashboard did not render first; count was ${cachedCount}.`);
if (firstPaintMs > 1500) throw new Error(`Cached first paint took ${firstPaintMs}ms.`);
await page.waitForFunction(() => {
  const cache = localStorage.getItem("amo-procedure-cases-v1") || "";
  return !cache.includes("cached-first-paint");
}, null, { timeout: 20000 });

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
console.log(`PASS: cached dashboard rendered first in ${firstPaintMs}ms, then refreshed from Sheet.`);
console.log("PASS: shift, zone, patient ID, procedure and save flow work on a mobile viewport.");
console.log("PASS: migration preview performed zero production writes.");
console.log("PASS: mobile layout has no horizontal overflow.");
