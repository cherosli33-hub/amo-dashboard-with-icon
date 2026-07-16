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

Kod backend tersedia dalam folder `google-apps-script`. Fungsi `setupAsthmaSheets()` membina tiga tab tanpa mengubah tab Dashboard A.M.O:

1. `Asthma_Assessment` — satu baris bagi setiap penilaian, termasuk `Record ID`, PEFR Not Done dan `Nama PPP`.
2. `Asthma_Dashboard` — statistik yang dikira daripada `Asthma_Assessment`.
3. `PEFR_Reference` — jadual rujukan dewasa dan pediatrik EU/EN13826.

### Cara menyediakan Apps Script

1. Buka Google Sheet yang hendak digunakan.
2. Pilih **Extensions > Apps Script**.
3. Salin kandungan `google-apps-script/Code.gs` ke fail `Code.gs`.
4. Jalankan `setupAsthmaSheets()` sekali dan benarkan akses yang diminta.
5. Semak tiga tab di atas telah dicipta.
6. Pilih **Deploy > New deployment > Web app**.
7. Tetapkan **Execute as: Me** dan akses yang membolehkan PWA menghantar rekod.
8. Salin URL deployment yang berakhir dengan `/exec`.
9. Isi URL itu sebagai `sheetEndpoint` dalam `config.js`.

Secara lalai, rekod disimpan dalam `localStorage` peranti. Apabila endpoint diisi, aplikasi menghantar payload berikut melalui `doPost(e)`:

```json
{
  "action": "saveAsthmaAssessment",
  "record": {}
}
```

Endpoint sengaja diasingkan supaya modul Asma tidak mengubah fungsi Sheet Dashboard A.M.O sedia ada.

Jika penghantaran gagal pada peringkat rangkaian, rekod kekal pada peranti dan borang tidak dikosongkan supaya pengguna boleh cuba semula. Oleh sebab aplikasi mengendalikan maklumat pesakit, pastikan tetapan perkongsian Sheet dan akaun pemilik mematuhi polisi privasi serta keselamatan data organisasi sebelum digunakan secara sebenar.

## Pasang pada telefon

- Android/Chrome: buka URL aplikasi, pilih **Install app** atau **Add to Home screen**.
- iPhone/Safari: buka URL aplikasi, pilih **Share > Add to Home Screen**.

## GitHub Pages

Gunakan **Deploy from a branch**, branch `main`, folder `/ (root)`.
