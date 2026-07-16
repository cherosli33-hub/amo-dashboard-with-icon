export const PAEDIATRIC_PEFR = Object.freeze({
  85: 87,
  90: 95,
  95: 104,
  100: 115,
  105: 127,
  110: 141,
  115: 157,
  120: 174,
  125: 192,
  130: 212,
  135: 233,
  140: 254,
  145: 276,
  150: 299,
  155: 323,
  160: 346,
  165: 370,
  170: 393
});

export function wrightToEu(wrightValue) {
  const w = Number(wrightValue);
  if (!Number.isFinite(w) || w <= 0) return null;
  return 50.356 + (0.4 * w) + (0.0008814 * w ** 2) - (0.0000001116 * w ** 3);
}

export function predictedAdultPef({ age, sex, heightCm }) {
  const a = Number(age);
  const h = Number(heightCm);
  if (!Number.isFinite(a) || !Number.isFinite(h) || a < 15 || a > 85 || h <= 0) return null;
  const normalizedSex = String(sex).toLowerCase();
  let logWright;
  if (normalizedSex === "male") {
    logWright = (0.544 * Math.log(a)) - (0.0151 * a) - (74.7 / h) + 5.48;
  } else if (normalizedSex === "female") {
    logWright = (0.376 * Math.log(a)) - (0.012 * a) - (58.8 / h) + 5.63;
  } else {
    return null;
  }
  return Math.round(wrightToEu(Math.exp(logWright)));
}

export function predictedPaediatricPef(heightCm) {
  const height = Number(heightCm);
  return PAEDIATRIC_PEFR[height] ?? null;
}

export function pefrPercentage(observed, predicted) {
  const value = Number(observed);
  const ideal = Number(predicted);
  if (!Number.isFinite(value) || !Number.isFinite(ideal) || value <= 0 || ideal <= 0) return null;
  return Math.round((value / ideal) * 1000) / 10;
}

export function classifyPercentage(percentage) {
  const value = Number(percentage);
  if (!Number.isFinite(value)) return null;
  if (value > 80) return { key: "mild", label: "Mild", range: ">80%" };
  if (value >= 60) return { key: "moderate", label: "Moderate", range: "60–80%" };
  return { key: "severe", label: "Severe", range: "<60%" };
}
