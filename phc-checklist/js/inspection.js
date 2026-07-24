import { categoriesForBag, isoDate, loadLatestInventory, loadRecords } from "./app.js";
import { saveInspection } from "./api.js";

const root=document.querySelector("#inspectionApp");
const title=document.querySelector("#inspectionTitle");
const state={stage:"setup",bag:"",ppp:"",shift:"",categoryIndex:0,quantities:{},notes:"",startMode:"new",saving:false,saveResult:null};

function toast(message){ const el=document.querySelector("#toast"); el.textContent=message; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),2200); }
function esc(value=""){ return String(value).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
function buildQuantities(mode){
  const categories=categoriesForBag(state.bag); const last=loadLatestInventory()[state.bag]||loadRecords().find(record=>record.bag===state.bag && record.quantities && Object.keys(record.quantities).length);
  state.startMode=mode; state.quantities={}; categories.forEach(category=>{ const previous=mode==="copy"?last?.quantities?.[category.id]?.items:null; state.quantities[category.id]={items:category.items.map(([name,standard])=>({name,standard,qty:Math.min(standard,previous?.find(item=>item.name===name)?.qty ?? standard)}))}; });
}

function renderSetup(){ title.textContent="Maklumat pemeriksaan"; root.innerHTML=`<section class="setup-panel"><div class="setup-hero"><div class="step-icon">▣</div><p class="eyebrow">LANGKAH 1</p><h1>Mulakan pemeriksaan</h1><p>Pilih beg, masukkan nama PPP dan shift bertugas.</p></div><div class="card form-card"><div class="field"><label class="field-label">Pilih beg PHC</label><div class="choice-grid"><button class="choice ${state.bag==="PHC 1"?"selected":""}" data-bag="PHC 1"><span>①</span>PHC 1<small> · 7 kategori</small></button><button class="choice ${state.bag==="PHC 2"?"selected":""}" data-bag="PHC 2"><span>②</span>PHC 2<small> · 6 kategori</small></button></div></div><div class="field"><label class="field-label" for="pppName">Nama PPP</label><input class="text-input" id="pppName" autocomplete="name" placeholder="Contoh: Rosli" value="${esc(state.ppp)}"></div><div class="field"><label class="field-label">Shift</label><div class="choice-grid shift-grid">${["Pagi","Petang","Malam"].map((shift,i)=>`<button class="choice ${state.shift===shift?"selected":""}" data-shift="${shift}"><span>${["☀","◐","☾"][i]}</span>${shift}</button>`).join("")}</div></div><div class="field"><label class="field-label">Cara mula pemeriksaan</label><div class="start-options"><button class="start-option copy" data-start-mode="copy" ${!state.bag||!state.shift?"disabled":""}><span>↻</span><div><strong>Salin Rekod Terakhir</strong><small>Gunakan kuantiti pemeriksaan lepas</small></div></button><button class="start-option new" data-start-mode="new" ${!state.bag||!state.shift?"disabled":""}><span>＋</span><div><strong>Mulakan Rekod Baru</strong><small>Mulakan dengan kuantiti standard</small></div></button></div></div></div></section>`;
}

function renderCategory(){
  const categories=categoriesForBag(state.bag); const category=categories[state.categoryIndex]; const items=state.quantities[category.id].items; const percent=(state.categoryIndex+1)/categories.length*100;
  title.textContent=category.name;
  root.innerHTML=`<div class="inspection-progress"><div class="progress-meta"><span>${state.bag} · ${state.shift}</span><span>Kategori ${state.categoryIndex+1} / ${categories.length}</span></div><div class="progress-track"><span style="width:${percent}%"></span></div></div><section class="category-head"><span class="category-number">${state.categoryIndex+1}</span><div><h1>${category.name}</h1><small>${items.length} item · semak kuantiti semasa</small></div></section>${state.categoryIndex===0?`<div class="copy-banner">${state.startMode==="copy"?`↻ Rekod terakhir untuk ${state.bag} telah disalin. Ubah item yang berbeza sahaja.`:`＋ Rekod baru dimulakan menggunakan kuantiti standard ${state.bag}.`}</div>`:""}<section class="checklist">${items.map((item,index)=>itemRow(category.id,item,index)).join("")}</section><div class="inspection-footer"><button class="button secondary" id="previousStep">${state.categoryIndex===0?"Batal":"← Sebelum"}</button><button class="button primary" id="nextStep">${state.categoryIndex===categories.length-1?"Semak & catatan":"Seterusnya →"}</button></div>`;
}
function itemRow(categoryId,item,index){ const low=item.qty<item.standard; return `<article class="item-row"><div class="item-copy"><strong>${item.name}</strong><small>Standard: ${item.standard}</small><span class="item-status ${low?"low":"ok"}">${low?"⚠ Kurang":"✓ Lengkap"}</span></div><div class="stepper"><button data-step="-1" data-category="${categoryId}" data-index="${index}" aria-label="Kurangkan ${item.name}">−</button><output>${item.qty}</output><button data-step="1" data-category="${categoryId}" data-index="${index}" aria-label="Tambah ${item.name}">＋</button></div></article>`; }

function renderReview(){
  title.textContent="Semak & simpan"; const categories=categoriesForBag(state.bag); const lows=categories.flatMap(category=>state.quantities[category.id].items).filter(item=>item.qty<item.standard);
  root.innerHTML=`<section class="setup-panel"><div class="setup-hero"><div class="step-icon">✓</div><p class="eyebrow">SEMAKAN AKHIR</p><h1>Pastikan maklumat betul</h1><p>${lows.length?`${lows.length} item ditanda kurang dan akan muncul dalam alert restock.`:"Semua item memenuhi kuantiti standard."}</p></div><div class="review-list"><div class="review-row"><span>Beg</span><strong>${state.bag}</strong></div><div class="review-row"><span>PPP</span><strong>${esc(state.ppp)}</strong></div><div class="review-row"><span>Shift</span><strong>${state.shift}</strong></div><div class="review-row"><span>Kategori</span><strong>${categories.length} selesai</strong></div><div class="review-row"><span>Item kurang</span><strong style="color:${lows.length?"var(--danger)":"var(--success)"}">${lows.length}</strong></div></div><div class="field" style="margin-top:16px"><label class="field-label" for="notes">Catatan (pilihan)</label><textarea class="notes-input" id="notes" placeholder="Contoh: Stok digunakan semasa kes...">${esc(state.notes)}</textarea></div><div class="inspection-footer"><button class="button secondary" id="editChecklist">← Kembali</button><button class="button primary" id="saveInspection">Simpan pemeriksaan</button></div></section>`;
}
function renderSuccess(){ const synced=state.saveResult?.synced; title.textContent="Pemeriksaan selesai"; root.innerHTML=`<section class="card success-panel"><div class="success-check">✓</div><h1>Pemeriksaan berjaya</h1><p>${state.bag} · ${state.shift}<br>Direkod atas nama ${esc(state.ppp)}</p><div class="sync-message ${synced?"synced":"pending"}"><strong>${synced?"✓ Tersimpan dalam Google Sheet":"↻ Menunggu sync"}</strong><br>${esc(state.saveResult?.message||"")}</div><button class="button primary full" onclick="location.href='index.html'">Kembali ke Dashboard</button></section>`; }

function render(){ if(state.stage==="setup") renderSetup(); else if(state.stage==="category") renderCategory(); else if(state.stage==="review") renderReview(); else renderSuccess(); window.scrollTo({top:0,behavior:"smooth"}); }

root.addEventListener("click",async event=>{
  const bag=event.target.closest("[data-bag]"); if(bag){ state.bag=bag.dataset.bag; state.ppp=document.querySelector("#pppName")?.value||state.ppp; render(); return; }
  const shift=event.target.closest("[data-shift]"); if(shift){ state.shift=shift.dataset.shift; state.ppp=document.querySelector("#pppName")?.value||state.ppp; render(); return; }
  const startButton=event.target.closest("[data-start-mode]"); if(startButton){ state.ppp=document.querySelector("#pppName").value.trim(); if(!state.ppp){ document.querySelector("#pppName").focus(); toast("Masukkan nama PPP dahulu."); return; } buildQuantities(startButton.dataset.startMode); state.stage=startButton.dataset.startMode==="copy"?"review":"category"; render(); return; }
  const step=event.target.closest("[data-step]"); if(step){ const item=state.quantities[step.dataset.category].items[Number(step.dataset.index)]; item.qty=Math.min(item.standard,Math.max(0,item.qty+Number(step.dataset.step))); renderCategory(); return; }
  if(event.target.closest("#previousStep")){ if(state.categoryIndex===0){ state.stage="setup"; } else state.categoryIndex--; render(); return; }
  if(event.target.closest("#nextStep")){ const total=categoriesForBag(state.bag).length; if(state.categoryIndex<total-1) state.categoryIndex++; else state.stage="review"; render(); return; }
  if(event.target.closest("#editChecklist")){ state.notes=document.querySelector("#notes")?.value||""; state.stage="category"; render(); return; }
  if(event.target.closest("#saveInspection")){ await saveCurrentInspection(); }
});

async function saveCurrentInspection(){
  if(state.saving) return;
  state.notes=document.querySelector("#notes")?.value.trim()||"";
  const now=new Date(); const button=document.querySelector("#saveInspection");
  const record={id:`PHC-${now.getTime()}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16)}`,checkKey:`${isoDate(now)}|${state.bag}|${state.shift}`,savedAt:now.toISOString(),date:isoDate(now),time:new Intl.DateTimeFormat("ms-MY",{hour:"2-digit",minute:"2-digit",hour12:false}).format(now),bag:state.bag,shift:state.shift,ppp:state.ppp,notes:state.notes,quantities:state.quantities};
  state.saving=true; if(button){ button.disabled=true; button.textContent="Menyimpan..."; }
  state.saveResult=await saveInspection(record);
  state.saving=false; state.stage="success"; render();
}

render();
