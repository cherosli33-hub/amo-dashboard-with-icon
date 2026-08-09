// AMO Dashboard v2 — penambahbaikan UI draf Asma.
// Tidak digunakan oleh branch main/live.

const style = document.createElement("style");
style.textContent = `
  .draft-list .draft-item{
    position:relative!important;
    display:grid!important;
    grid-template-columns:minmax(0,1fr) auto!important;
    gap:10px 12px!important;
    align-items:center!important;
    padding:14px!important;
    cursor:pointer!important;
    border-radius:14px!important;
  }
  .draft-list .draft-item:hover{box-shadow:0 0 0 2px rgba(8,127,115,.12)!important}
  .draft-list .draft-copy{min-width:0!important;grid-column:1/2!important}
  .draft-list .draft-copy strong,.draft-list .draft-copy small{display:block!important}
  .draft-list .draft-open{grid-column:2/3!important;grid-row:1!important;min-width:92px!important;min-height:42px!important;padding:10px 14px!important;font-weight:800!important}
  .draft-list .draft-delete{
    grid-column:1/3!important;
    grid-row:2!important;
    justify-self:stretch!important;
    width:100%!important;
    min-height:40px!important;
    margin:0!important;
    padding:9px 12px!important;
    border:1px solid #efb9b9!important;
    border-radius:10px!important;
    background:#fff5f5!important;
    color:#a92f2f!important;
    font-weight:800!important;
  }
  .draft-list .draft-item::after{content:"Tekan kad ini untuk sambung draf";grid-column:1/2;grid-row:2;color:var(--muted,#657a75);font-size:11px;align-self:center;padding-left:2px}
  .draft-list .draft-delete{grid-column:2/3!important;width:auto!important;min-width:92px!important}
  @media(max-width:560px){
    .draft-list .draft-item{grid-template-columns:1fr!important}
    .draft-list .draft-copy,.draft-list .draft-open,.draft-list .draft-delete,.draft-list .draft-item::after{grid-column:1!important}
    .draft-list .draft-open{grid-row:2!important;width:100%!important}
    .draft-list .draft-delete{grid-row:3!important;width:100%!important}
    .draft-list .draft-item::after{display:none!important}
  }
`;
document.head.appendChild(style);

if (!document.body) await new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once:true }));

// Seluruh kad draf boleh ditekan untuk sambung, kecuali bila pengguna menekan butang Padam/Sambung sendiri.
document.addEventListener("click", event => {
  const card = event.target.closest?.(".draft-item");
  if (!card || event.target.closest("button, input, select, textarea, a")) return;
  const open = card.querySelector(".draft-open");
  if (open) {
    event.preventDefault();
    open.click();
  }
});

// Sokong keyboard apabila fokus dipindah ke kad melalui enhancement ini.
const observer = new MutationObserver(() => {
  document.querySelectorAll(".draft-item").forEach(card => {
    if (card.dataset.easyDraftAccess === "1") return;
    card.dataset.easyDraftAccess = "1";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Sambung draf ${card.querySelector("strong")?.textContent || "pesakit"}`);
    card.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      card.querySelector(".draft-open")?.click();
    });
  });
});
observer.observe(document.body, { childList:true, subtree:true });
window.addEventListener("beforeunload", () => observer.disconnect());
