# AMO Dashboard v2 - audit dan migrasi Firebase

## Garis dasar yang dikunci

- Repo: `cherosli33-hub/amo-dashboard-with-icon`
- Baseline: branch `main`, commit `01aca9e`
- Branch pembangunan: `firebase-v2`
- Empat app sumber: `/amo.html`, `/asthma.html`, `/phc-checklist/`, `/girn/`
- `main`, GitHub Pages live dan semua Apps Script live tidak diubah.

## Audit branch sebelum pembaikan

Branch `firebase-v2` hanya mempunyai enam fail asas dalam `shared/firebase/`. Tiada app mengimportnya, semua endpoint masih Google Apps Script, tiada rules, tiada migrasi data, tiada SSO bersama dan tiada dashboard data pusat.

## Aliran lama yang disahkan (baca sahaja, 9 Ogos 2026)

| Modul | Semantik sumber | Kiraan semasa audit |
|---|---|---:|
| Prosedur | Satu kes mengandungi banyak prosedur; Sheet menyimpan satu baris setiap prosedur | 1,032 baris / 781 kes |
| Asma | Satu dokumen setiap penilaian PEFR dengan semantik 27 medan asal | 53 rekod |
| PHC | Pemeriksaan per `date|bag|shift`, kuantiti kategori/item, penemuan dan pengesahan penyelia | 73 pemeriksaan, 100 penemuan |
| GIRN | Pemeriksaan enam peralatan per syif, penemuan dan status tindakan | 31 pemeriksaan, 21 penemuan |

## Schema Firestore v2

- `procedure_cases/{caseId}` - satu kes, array `procedures[]`; mengekalkan ID pesakit, zon, syif, tarikh dan minit.
- `asthma_assessments/{recordId}` - satu penilaian; nama medan frontend lama dikekalkan.
- `phc_inspections/{recordId}` - satu pemeriksaan; `quantities` kekal bernest mengikut kategori.
- `phc_findings/{findingId}` - penemuan kekurangan atau catatan pengguna.
- `girn_inspections/{recordId}` - satu pemeriksaan dengan `devices[]`.
- `girn_findings/{findingId}` - status Baharu / Diambil maklum / Selesai dan jejak tindakan.
- `users/{uid}` - profil Google dan peranan `pending`, `supervisor` atau `admin`.

Pengguna biasa mendapat sesi Firebase Anonymous secara senyap; tiada skrin login. Login Google menggunakan persistence tempatan, jadi sesi admin/penyelia digunakan semula oleh portal, dashboard data dan PHC sehingga Log keluar.

## Import data lama

Importer idempotent berada di `tools/firebase-import/import.mjs`. Ia menjalankan dry-run secara lalai dan hanya menulis apabila diberi `--commit`. Jangan commit kunci service account.

## Konfigurasi dan deployment selesai (9 Ogos 2026)

- Akaun staf yang telah diluluskan dalam kod dan Firestore Rules:
  - Admin: `cherosli33@gmail.com`
  - Supervisor: `yusseriharon6835@gmail.com`
- Kedua-dua akaun menerima peranan secara automatik pada login Google pertama.
- Firebase Authentication `Anonymous` dan `Google` telah diaktifkan; auto-cleanup anonymous 30 hari turut aktif.
- Firestore Rules telah diterbitkan dan domain `amo-dashboard-v2.pages.dev` telah ditambah kepada Authorized Domains.
- Cloudflare Pages menggunakan branch production `firebase-v2`, build command kosong dan output directory `/`.
- URL deployment: `https://amo-dashboard-v2.pages.dev/`.
- Import sebenar selesai secara idempotent: 781 Prosedur, 53 Asma, 73 PHC, 100 PHC findings, 31 GIRN dan 21 GIRN findings.
- Login admin, SSO, dashboard pusat dan paparan semua empat modul telah disahkan pada domain Cloudflare.

## Ujian penerimaan sebelum dibuka kepada pengguna

1. Login sekali menggunakan akaun supervisor dan sahkan akses PHC serta dashboard data pusat.
2. Simpan satu rekod ujian baharu bagi setiap modul, kemudian sahkan bacaan semula pada peranti lain.
3. Uji logout, pengesahan PHC, status tindakan GIRN, laporan dan eksport CSV.
4. Custom domain adalah pilihan; domain `pages.dev` sudah berfungsi tanpa pembelian domain.

## Cutover dan rollback

Apps Script dan Google Sheets lama kekal tidak berubah sebagai sumber rollback. Jangan arahkan pengguna live ke domain Cloudflare sehingga import, kiraan rekod dan ujian penerimaan selesai. Importer boleh diulang kerana setiap dokumen menggunakan ID stabil dan `merge`.
