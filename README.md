# A.M.O ETD LEPEH

PWA mudah alih yang menyediakan satu portal untuk:

1. Dashboard Log Prosedur A.M.O sedia ada.
2. Dashboard Penilaian PEFR Pesakit Asma.

## URL aplikasi

`https://cherosli33-hub.github.io/amo-dashboard-with-icon/`

## Modul Penilaian Asma

Modul Asma merangkumi:

- PEFR ideal dewasa berdasarkan persamaan Nunn–Gregg dan penukaran skala EU/EN13826.
- PEFR ideal pediatrik berdasarkan jadual tinggi 85–170 cm yang dibekalkan.
- Pengiraan `%PEFR = observed ÷ predicted × 100`.
- Kategori Mild `>80%`, Moderate `60–80%`, dan Severe `<60%`.
- PEFR Before dan After.
- Uptriage manual oleh PPP: Tiada, Yellow Zone, atau Red Zone.
- PEFR Not Done berserta sebab daripada borang asal: Patient Refused/Uncooperative, Severe Asthma, Unable, atau Others.
- Nama PPP wajib diisi sebelum rekod disimpan.
- Senarai penilaian hari ini dan statistik asas pada peranti.
- Rujukan klinikal dewasa, pediatrik, dan interpretasi PEFR.

Modul tidak membuat cadangan uptriage atau keputusan klinikal automatik.

## Penyimpanan Google Sheet

Secara lalai, rekod disimpan dalam `localStorage` peranti. Untuk penyegerakan Google Sheet, isi `sheetEndpoint` dalam `config.js` dengan URL Apps Script `/exec` yang menerima payload berikut melalui `doPost(e)`:

```json
{
  "action": "saveAsthmaAssessment",
  "record": {}
}
```

Endpoint sengaja diasingkan supaya modul Asma tidak mengubah fungsi Sheet Dashboard A.M.O sedia ada.

## Pasang pada telefon

- Android/Chrome: buka URL aplikasi, pilih **Install app** atau **Add to Home screen**.
- iPhone/Safari: buka URL aplikasi, pilih **Share > Add to Home Screen**.

## GitHub Pages

Gunakan **Deploy from a branch**, branch `main`, folder `/ (root)`.
