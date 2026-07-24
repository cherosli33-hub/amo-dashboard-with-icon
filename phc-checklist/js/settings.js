import { APP_VERSION } from "./config.js";
import { apiConfigured, syncPendingInspections } from "./api.js";
import { LATEST_INVENTORY_KEY, PENDING_SYNC_KEY, STORAGE_KEY, loadPendingSync } from "./app.js";

const modal=document.querySelector("#settingsModal"); const status=document.querySelector("#syncStatus");
const copy={
  ppp:["Nama PPP","Nama PPP ditaip sendiri pada setiap pemeriksaan supaya rekod audit menunjukkan petugas sebenar."],
  quantity:["Kuantiti Standard","Master semasa mengandungi 78 item untuk PHC 1 dan 75 item untuk PHC 2. PHC 2 tidak mempunyai kategori Dextrostix."],
  about:["Tentang aplikasi",`PHC Checklist versi ${APP_VERSION}. Data dihantar ke Google Sheet dan salinan sementara disimpan pada peranti untuk kegunaan offline.`],
};
document.querySelectorAll("[data-setting]").forEach(button=>button.addEventListener("click",()=>{ const [title,text]=copy[button.dataset.setting]; modal.hidden=false; modal.innerHTML=`<section class="modal"><div class="modal-handle"></div><div class="modal-head"><h2>${title}</h2><button class="modal-close">×</button></div><p style="font-size:12px;line-height:1.7;color:var(--muted)">${text}</p></section>`; }));
modal.addEventListener("click",event=>{ if(event.target===modal||event.target.closest(".modal-close")) modal.hidden=true; });
document.querySelector("#clearCache").addEventListener("click",()=>{ if(confirm("Kosongkan salinan rekod pada peranti ini? Data yang sudah dihantar ke Google Sheet tidak akan dipadam.")){ localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LATEST_INVENTORY_KEY); if(!loadPendingSync().length) localStorage.removeItem(PENDING_SYNC_KEY); alert("Cache peranti telah dikosongkan."); location.href="index.html"; } });

async function showStatus(){
  const pending=loadPendingSync().length;
  if(!apiConfigured()){ status.className="sync-card pending"; status.innerHTML=`<strong>Google Sheet belum disambungkan</strong><p>${pending} rekod menunggu sync. Masukkan URL Apps Script dalam konfigurasi aplikasi.</p>`; return; }
  status.className="sync-card"; status.innerHTML=`<strong>Menyemak sambungan...</strong><p>${pending} rekod menunggu sync.</p>`;
  const result=await syncPendingInspections();
  status.className=`sync-card ${result.pending?"pending":"connected"}`;
  status.innerHTML=`<strong>${result.pending?"Ada rekod menunggu sync":"Google Sheet tersambung"}</strong><p>${result.synced} rekod baru dihantar · ${result.pending} masih menunggu.</p>`;
}
showStatus();
