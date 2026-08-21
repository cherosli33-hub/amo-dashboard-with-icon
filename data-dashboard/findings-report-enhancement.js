const style = document.createElement("style");
style.textContent = `
.finding-report-section{margin-top:22px}
.finding-report-section>p{margin:0 0 14px;color:#657a75}
.finding-report-day{break-inside:avoid;margin-top:12px;padding:14px 16px;border:1px solid #dbe9e4;border-radius:12px;background:#fbfdfc}
.finding-report-day h3{margin:0 0 8px;color:#174f46;font-size:14px}
.finding-report-item{padding:9px 0;border-top:1px solid #e6efec}
.finding-report-item:first-of-type{border-top:0}
.finding-report-item strong,.finding-report-item span,.finding-report-item small{display:block}
.finding-report-item strong{font-size:13px;color:#17332f}
.finding-report-item span{margin-top:3px;color:#48665d;font-size:12px;line-height:1.45}
.finding-report-item small{margin-top:4px;color:#70877f;font-size:11px}
.daily-report-table td:last-child strong{display:inline-flex;align-items:center;justify-content:center;padding:3px 8px;border-radius:999px;background:#fff3df;color:#9a5d08;font-size:11px}
.daily-report-table td:last-child>span{color:#6b817a}
@media print{
  .finding-report-day{page-break-inside:avoid;break-inside:avoid}
  .finding-report-section{page-break-before:auto}
}
`;
document.head.appendChild(style);
