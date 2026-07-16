(() => {
  const original = document.querySelector('#bp');
  if (!original) return;

  const wrapper = original.closest('.field');
  if (!wrapper) return;

  wrapper.innerHTML = `
    <label>BP</label>
    <div class="bp-split-row">
      <div class="unit-field">
        <input id="bpSys" name="bpSys" type="number" inputmode="numeric" min="40" max="300" placeholder="120" aria-label="BP systolic">
      </div>
      <span class="bp-separator" aria-hidden="true">/</span>
      <div class="unit-field">
        <input id="bpDia" name="bpDia" type="number" inputmode="numeric" min="20" max="200" placeholder="80" aria-label="BP diastolic">
        <span class="unit">mmHg</span>
      </div>
      <input id="bp" name="bp" type="hidden">
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    .bp-split-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      gap: 10px;
      align-items: center;
    }
    .bp-split-row .unit-field { min-width: 0; }
    .bp-separator {
      font-size: 1.6rem;
      font-weight: 800;
      color: var(--muted);
      line-height: 1;
    }
  `;
  document.head.append(style);

  const systolic = document.querySelector('#bpSys');
  const diastolic = document.querySelector('#bpDia');
  const combined = document.querySelector('#bp');

  const syncCombinedBp = () => {
    const sys = systolic.value.trim();
    const dia = diastolic.value.trim();
    combined.value = sys && dia ? `${sys}/${dia}` : '';
    combined.dispatchEvent(new Event('input', { bubbles: true }));
  };

  systolic.addEventListener('input', syncCombinedBp);
  diastolic.addEventListener('input', syncCombinedBp);
})();
