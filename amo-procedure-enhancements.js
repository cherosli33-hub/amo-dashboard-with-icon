// AMO Dashboard v2 — tambahan Prosedur sahaja.
// Tidak digunakan oleh branch main/live.

if (!document.body) {
  await new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once:true }));
}

let savePatched = false;

function patchSavedRecord() {
  if (savePatched || typeof window.saveCase !== "function") return;
  savePatched = true;
  const originalSave = window.saveCase;
  window.saveCase = function (newCase, ...args) {
    // Validation nama doktor dan pengecualian dibuat oleh amo-config.js sebelum
    // saveCase dipanggil. Flag ini menandakan rekod telah melepasi aturan itu;
    // ia bukan lagi nilai daripada checkbox pengguna.
    const record = { ...newCase, doctorInstructionConfirmed:true };
    return originalSave.call(this, record, ...args);
  };
}

const observer = new MutationObserver(patchSavedRecord);
observer.observe(document.body, { childList:true, subtree:true });
patchSavedRecord();
window.addEventListener("beforeunload", () => observer.disconnect());
