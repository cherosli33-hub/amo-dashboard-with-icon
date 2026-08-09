// AMO Dashboard v2 — tambahan Prosedur sahaja.
// Tidak digunakan oleh branch main/live.

const style = document.createElement("style");
style.textContent = `
  .doctor-order-confirm{margin:16px 0 12px;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--panel)}
  .doctor-order-confirm label{display:flex;align-items:flex-start;gap:11px;cursor:pointer;font-size:14px;font-weight:600;color:var(--text2)}
  .doctor-order-confirm input{width:20px;height:20px;margin-top:1px;accent-color:var(--accent);flex:0 0 auto}
  .doctor-order-confirm small{display:block;margin:5px 0 0 31px;color:var(--muted);font-size:12px;line-height:1.4}
  .doctor-order-confirm.required{border-color:#d99546;background:#fff9ef}
`;
document.head.appendChild(style);

if (!document.body) await new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once:true }));

let confirmed = false;
let patched = false;

function syncSaveButton() {
  const box = document.querySelector("#doctor-order-confirm-checkbox");
  const save = document.querySelector("#save-btn");
  if (!save || !box) return;
  const patientReady = String(window.state?.registrationNumber || "").trim().length > 0;
  const selectedCount = Object.keys(window.state?.selectedProcs || {}).length;
  save.disabled = !patientReady || selectedCount === 0 || Boolean(window.state?.saving) || !box.checked;
}

function injectConfirmation() {
  const saveBar = document.querySelector("#save-btn")?.closest(".save-bar");
  if (!saveBar || document.querySelector("#doctor-order-confirm")) return;
  const block = document.createElement("div");
  block.id = "doctor-order-confirm";
  block.className = "doctor-order-confirm required";
  block.innerHTML = `
    <label><input id="doctor-order-confirm-checkbox" type="checkbox"><span>Saya sahkan prosedur yang dipilih dibuat atas arahan Dr.</span></label>
    <small>Wajib ditanda sebelum rekod prosedur boleh disimpan.</small>
  `;
  saveBar.before(block);
  const checkbox = block.querySelector("input");
  checkbox.checked = confirmed;
  checkbox.addEventListener("change", () => {
    confirmed = checkbox.checked;
    block.classList.toggle("required", !confirmed);
    syncSaveButton();
  });
  syncSaveButton();
}

function patchSaveFlow() {
  if (patched || typeof window.handleSaveCase !== "function" || typeof window.saveCase !== "function") return;
  patched = true;
  const originalHandle = window.handleSaveCase;
  const originalSave = window.saveCase;

  window.handleSaveCase = function (...args) {
    const checkbox = document.querySelector("#doctor-order-confirm-checkbox");
    if (!checkbox?.checked) {
      document.querySelector("#doctor-order-confirm")?.classList.add("required");
      if (typeof window.showToast === "function") window.showToast("Sila tick pengesahan arahan Dr sebelum simpan.");
      else alert("Sila tick pengesahan arahan Dr sebelum simpan.");
      checkbox?.focus();
      return;
    }
    confirmed = true;
    return originalHandle.apply(this, args);
  };

  window.saveCase = function (newCase, ...args) {
    const record = { ...newCase, doctorInstructionConfirmed:true };
    const result = originalSave.call(this, record, ...args);
    Promise.resolve(result).finally(() => { confirmed = false; });
    return result;
  };
}

const observer = new MutationObserver(() => {
  patchSaveFlow();
  injectConfirmation();
  syncSaveButton();
});
observer.observe(document.body, { childList:true, subtree:true });
patchSaveFlow();
injectConfirmation();
window.addEventListener("beforeunload", () => observer.disconnect());
