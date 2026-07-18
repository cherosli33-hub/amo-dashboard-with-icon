# Migrasi Frontend Dashboard A.M.O ke GitHub Pages

Status: **Diluluskan untuk production — Apps Script lama kekal sebagai rollback**

## Hasil semasa

- `amo.html` dijana terus daripada `DASHBOARD_HTML` yang digunakan oleh deployment production.
- Reka bentuk, label, susunan, aliran shift/zon/ID pesakit/prosedur dan carta dikekalkan.
- `amo-config.js` menggunakan endpoint Apps Script sedia ada untuk bacaan data.
- Dashboard terus dipaparkan daripada cache `localStorage`; ia tidak menunggu Google Sheet sebelum membuka aplikasi.
- Google Sheet dimuat semula di belakang tabir dan cache telefon dikemas kini selepas respons diterima.
- Font web dimuat secara tidak menyekat supaya paparan awal tidak tertangguh.
- Paparan telefon dipadatkan dan butang `+` dikunci di bawah skrin supaya sentiasa boleh ditekan tanpa scroll.
- `writeEnabled` diaktifkan supaya rekod baharu dihantar ke Google Sheet melalui Apps Script sedia ada.
- Portal utama membuka `amo.html`; URL Apps Script lama masih disimpan sebagai laluan rollback.
- Fail `.clasp.json` dan Script ID tidak dimasukkan ke Git.

Cutover dibuat selepas pengguna meluluskan paparan cache-first dan susun atur telefon pada 19 Julai 2026.

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

### Fasa 1 — Salinan visual ✅

- Cipta `amo.html` daripada HTML production yang tertanam dalam `Code.js`
- Salin HTML/CSS/JavaScript asal tanpa mengubah reka bentuk
- Kekalkan semua label, butang, susunan dan aliran kerja
- Belum sambung ke data produksi

### Fasa 2 — Sambungan API preview ✅

- Gunakan endpoint `?action=data` sedia ada untuk bacaan
- Kekalkan penghantaran data dimatikan dalam preview
- Paparkan cache telefon dahulu, kemudian muat data Sheet harian dan trend 7 hari di belakang tabir
- Kemas kini statistik dan carta selepas data Sheet diterima tanpa menutup skrin dashboard
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

## Cara mengesahkan migration

Jalankan:

```text
node tools/verify-amo-migration.mjs
```

Pemeriksaan ini memastikan hanya sambungan konfigurasi dan sekatan tulis preview ditambah kepada HTML asal, portal production belum ditukar, dan Script ID tidak dijejak Git.

## Mengaktifkan penulisan selepas kelulusan

Jangan aktifkan semasa fasa preview. Selepas ujian bacaan, paparan dan aliran borang lulus:

1. Uji penghantaran dahulu menggunakan salinan Sheet atau rekod ujian yang dipersetujui.
2. Tukar `writeEnabled` kepada `true` pada branch ujian sahaja.
3. Sahkan satu rekod menghasilkan bilangan baris prosedur yang betul.
4. Barulah tukar pautan portal daripada Apps Script lama kepada `./amo.html`.
5. URL Apps Script lama kekal sebagai laluan rollback.
