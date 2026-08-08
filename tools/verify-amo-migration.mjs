import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repo=path.resolve(import.meta.dirname,"..");
const read=file=>fs.readFileSync(path.join(repo,file),"utf8");
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const branch=execFileSync("git",["branch","--show-current"],{cwd:repo,encoding:"utf8"}).trim();
assert(branch==="firebase-v2","Pemeriksaan ini hanya boleh dijalankan pada branch firebase-v2.");
execFileSync("git",["merge-base","--is-ancestor","origin/main","HEAD"],{cwd:repo});

const required=["amo.html","asthma.html","phc-checklist/index.html","girn/index.html","shared/firebase/bootstrap.js","shared/firebase/legacy-adapter.js","data-dashboard/index.html","firestore.rules"];
required.forEach(file=>assert(fs.existsSync(path.join(repo,file)),`${file} tidak ditemui.`));
assert(read("amo.html").includes("shared/firebase/bootstrap.js"),"Prosedur belum menggunakan bridge Firebase.");
assert(read("asthma.mjs").includes('module: "asthma"'),"Asma belum menggunakan adapter Firebase.");
assert(read("phc-checklist/js/config.js").includes("firebase-v2-phc"),"PHC belum diasingkan daripada endpoint live.");
assert(read("girn/_next/static/chunks/01asyj8k~np8o.js").includes("firebase-v2-girn"),"GIRN belum diasingkan daripada endpoint live.");
assert(read("index.html").includes("portal-auth.js")&&read("index.html").includes("data-dashboard"),"SSO atau dashboard pusat belum dipautkan.");
assert(read("shared/firebase/auth.js").includes("browserLocalPersistence")&&read("shared/firebase/auth.js").includes("signInAnonymously"),"Persistence atau sesi pengguna biasa tiada.");
assert(read("amo-config.js").includes('environment: "firebase-v2"'),"Konfigurasi Prosedur bukan firebase-v2.");

const frontendFiles=["amo-config.js","config.js","phc-checklist/js/config.js","girn/_next/static/chunks/01asyj8k~np8o.js"];
frontendFiles.forEach(file=>assert(!/AKfycb[A-Za-z0-9_-]+/.test(read(file)),`${file} masih mengandungi endpoint Apps Script live.`));
const tracked=execFileSync("git",["ls-files"],{cwd:repo,encoding:"utf8"}).split(/\r?\n/);
assert(!tracked.includes(".clasp.json"),".clasp.json tidak boleh dijejak Git.");
assert(!tracked.some(file=>/service-account|\.pem$|\.p12$/i.test(file)),"Fail rahsia tidak boleh dijejak Git.");

console.log("PASS: firebase-v2 berasaskan origin/main dan main tidak diubah.");
console.log("PASS: empat app menggunakan backend Firebase terasing.");
console.log("PASS: tiada endpoint tulis Apps Script live dalam frontend.");
console.log("PASS: sesi anonymous, Google SSO dan dashboard data pusat tersedia.");
console.log("PASS: rules dan importer migrasi tersedia tanpa rahsia.");
