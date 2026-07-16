# Migrasi Frontend Dashboard A.M.O ke GitHub Pages

Status: **Persediaan selamat — dashboard lama kekal digunakan**

## Matlamat

Pindahkan paparan Dashboard Log Prosedur A.M.O daripada Google Apps Script HTML ke GitHub Pages tanpa mengubah reka bentuk, susunan, fungsi, nama medan, carta atau struktur data Google Sheet.

## Prinsip keselamatan

1. Dashboard Apps Script sedia ada kekal aktif sebagai versi produksi dan backup.
2. Semua pembangunan dibuat pada branch `amo-frontend-github-migration`.
3. Butang portal utama tidak ditukar sehingga versi GitHub diuji dan diluluskan.
4. Google Apps Script kekal sebagai backend API untuk baca/simpan data.
5. Struktur tab dan rekod Google Sheet tidak diubah semasa fasa penyalinan frontend.
6. Ujian dibuat side-by-side antara versi Apps Script dan versi GitHub.

## Bahan sumber yang diperlukan

Salin fail frontend daripada projek Apps Script A.M.O:

- Semua fail `.html` yang mengandungi paparan utama
- Fail CSS jika diasingkan
- Fail JavaScript jika diasingkan
- `Code.gs` semasa untuk mengenal pasti fungsi API, nama tindakan dan struktur payload

Tanpa kod sumber ini, reka bentuk tidak boleh disalin 100% dengan selamat hanya daripada URL deployment.

## Pelan pelaksanaan

### Fasa 1 — Salinan visual

- Cipta `amo.html`
- Salin HTML/CSS/JavaScript asal tanpa mengubah reka bentuk
- Kekalkan semua label, butang, susunan dan aliran kerja
- Belum sambung ke data produksi

### Fasa 2 — Backend API

- Pisahkan fungsi Apps Script kepada endpoint baca dan simpan
- Muat data hari ini dahulu
- Muat statistik dan carta sejarah selepas paparan utama muncul
- Kekalkan payload dan struktur Google Sheet sedia ada

### Fasa 3 — Ujian selari

- Uji tambah rekod
- Uji ID pesakit wajib
- Uji zon dan prosedur
- Uji tempoh prosedur
- Uji senarai pesakit harian
- Uji carta dan penapis tarikh
- Bandingkan hasil dengan dashboard lama

### Fasa 4 — Pelancaran

- Tukar butang portal kepada `./amo.html` hanya selepas kelulusan
- Kekalkan URL Apps Script lama sebagai pautan backup sementara
- Pantau penyimpanan data sebelum menutup versi lama
