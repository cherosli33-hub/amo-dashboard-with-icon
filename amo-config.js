window.AMO_CONFIG = Object.freeze({
  // Marker URL intercepted by shared/firebase/bootstrap.js. It is deliberately
  // not a live Apps Script deployment, so a bridge failure cannot write to production.
  apiUrl: "https://script.google.com/macros/s/firebase-v2-procedure/exec",
  writeEnabled: true,
  environment: "firebase-v2"
});

// Firebase v2 procedure refinements. Kept here so the stable single-file UI
// remains untouched while validation/report behaviour can evolve safely.
document.addEventListener("DOMContentLoaded", () => {
  const normalized = value => String(value || "").trim().toLowerCase().replace(/[’‘]/g, "'");
  const secondaryExempt = new Set(["vital sign", "dressing", "ryle's tube", "cbd"]);

  function doctorRequired(name, zone) {
    const procedure = normalized(name);
    if (zone === "secondary_triage" && secondaryExempt.has(procedure)) return false;
    if ((zone === "yellow_zone" || zone === "red_zone") && procedure === "ambulance call") return false;
    return true;
  }

  function cleanConfirmationCheckbox() {
    document.querySelectorAll("label, .checkbox-row, .field-group").forEach(node => {
      if (normalized(node.textContent).includes("saya sahkan prosedur yang dipilih dibuat atas arahan dr")) node.remove();
    });
  }

  if (typeof renderNewCase === "function") {
    const baseRenderNewCase = renderNewCase;
    renderNewCase = function () {
      baseRenderNewCase();
      cleanConfirmationCheckbox();
      if (typeof state === "undefined" || state.step !== 3) return;
      Object.keys(state.selectedProcs || {}).forEach(name => {
        const safeId = name.replace(/[^a-zA-Z0-9]/g, "_");
        const card = document.getElementById(`card_${safeId}`);
        const field = card?.querySelector(".doctor-field");
        if (!field) return;
        const required = doctorRequired(name, state.selectedZone);
        if (!required) {
          field.remove();
          return;
        }
        const label = field.querySelector(".field-label");
        const input = field.querySelector("input");
        const help = field.querySelector(".field-help");
        if (label) label.textContent = "Arahan daripada Dr. (wajib)";
        if (input) input.required = true;
        if (help) help.textContent = "Nama doktor mesti diisi sebelum rekod boleh disimpan.";
      });
    };
  }

  if (typeof handleSaveCase === "function") {
    const baseHandleSaveCase = handleSaveCase;
    handleSaveCase = function () {
      const missing = Object.keys(state?.selectedProcs || {}).find(name => {
        if (!doctorRequired(name, state.selectedZone)) return false;
        return !String(durationState(name).orderedBy || "").trim();
      });
      if (missing) {
        showToast(`Sila isi nama Dr. yang memberi arahan untuk ${missing}`);
        const safeId = missing.replace(/[^a-zA-Z0-9]/g, "_");
        const input = document.querySelector(`#card_${safeId} .doctor-field input`);
        input?.focus();
        return;
      }
      baseHandleSaveCase();
    };
  }

  if (typeof reportPreviewHtml === "function") {
    const baseReportPreviewHtml = reportPreviewHtml;
    reportPreviewHtml = function (cases) {
      const base = baseReportPreviewHtml(cases);
      const hourCounts = new Map();
      const dayCounts = new Map();
      const procedureCounts = new Map();
      let procedureTotal = 0;

      (cases || []).forEach(item => {
        const qty = Array.isArray(item.procedures) ? item.procedures.length : 0;
        procedureTotal += qty;
        const dateKey = String(item.date || "").slice(0, 10);
        if (dateKey) dayCounts.set(dateKey, (dayCounts.get(dateKey) || 0) + qty);
        const match = String(item.time || "").match(/(\d{1,2})[:.](\d{2})/);
        if (match) {
          const hour = String(Number(match[1])).padStart(2, "0");
          hourCounts.set(hour, (hourCounts.get(hour) || 0) + qty);
        }
        (item.procedures || []).forEach(proc => {
          const name = String(proc.name || "Tidak dinyatakan");
          procedureCounts.set(name, (procedureCounts.get(name) || 0) + 1);
        });
      });

      const peakHour = [...hourCounts.entries()].sort((a,b) => b[1] - a[1])[0];
      const peakDay = [...dayCounts.entries()].sort((a,b) => b[1] - a[1])[0];
      const ranked = [...procedureCounts.entries()].sort((a,b) => b[1] - a[1]);
      const max = ranked[0]?.[1] || 1;
      const fmtDay = value => {
        const date = new Date(`${value}T12:00:00+08:00`);
        return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("ms-MY", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
      };
      const bars = ranked.length ? ranked.map(([name,count]) => `
        <div class="report-rank-row">
          <div class="report-rank-label"><span>${esc(name)}</span><strong>${count} · ${procedureTotal ? (count / procedureTotal * 100).toFixed(1) : "0.0"}%</strong></div>
          <div class="report-rank-track"><i style="width:${Math.max(4, count / max * 100)}%"></i></div>
        </div>`).join("") : `<div class="report-empty">Tiada data prosedur untuk graf.</div>`;
      const analytics = `
        <section class="report-analytics">
          <div class="report-peak-grid">
            <article><small>Waktu puncak</small><strong>${peakHour ? `${peakHour[0]}:00–${peakHour[0]}:59` : "—"}</strong><span>${peakHour ? `${peakHour[1]} prosedur` : "Tiada data"}</span></article>
            <article><small>Hari paling sibuk</small><strong>${peakDay ? esc(fmtDay(peakDay[0])) : "—"}</strong><span>${peakDay ? `${peakDay[1]} prosedur` : "Tiada data"}</span></article>
          </div>
          <h3>Graf prosedur terbanyak hingga paling sedikit</h3>
          <div class="report-rank-list">${bars}</div>
        </section>`;
      const style = `<style>
        .report-analytics{margin-top:16px;break-inside:avoid}.report-analytics h3{margin:16px 0 9px;font:700 13px 'Space Grotesk',sans-serif;color:#263b32}
        .report-peak-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.report-peak-grid article{padding:11px;border:1px solid #dce9e2;border-radius:9px;background:#f7fbf9}
        .report-peak-grid small,.report-peak-grid span{display:block;color:#607269;font-size:9px}.report-peak-grid strong{display:block;margin:3px 0;color:#173f2d;font-size:13px}
        .report-rank-row{margin:8px 0}.report-rank-label{display:flex;justify-content:space-between;gap:12px;font-size:10px}.report-rank-label strong{white-space:nowrap;color:#486358}
        .report-rank-track{height:7px;margin-top:4px;border-radius:99px;background:#edf1ee;overflow:hidden}.report-rank-track i{display:block;height:100%;border-radius:99px;background:#1c9665}
        @media(max-width:520px){.report-peak-grid{grid-template-columns:1fr}}
        @media print{.report-peak-grid{grid-template-columns:1fr 1fr}.report-rank-track{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
      </style>`;
      return base.replace(/<footer class="report-print-footer">/, `${style}${analytics}<footer class="report-print-footer">`);
    };
  }
});
