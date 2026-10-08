# PHC Checklist

Sistem pemeriksaan inventori Beg Pre Hospital Care untuk Hospital Kuala Lipis.

## Firebase V2 dashboard live updates (2.8.5)

The Firebase V2 dashboard subscribes to inspections and findings for the selected
operational week, plus all findings whose status is `Belum diambil tindakan`.
Older unresolved restock items and notes therefore remain visible. Healthy
listeners do not run repeated dashboard queries. Date/status queries use separate
single-field indexes; no Firestore rules or composite-index deployment is needed.

Pending inspections and restock actions keep their existing durable local queue.
They sync on entry/reconnect and retry failed writes with backoff (5–60 seconds),
independently of reads. Focus/pageshow events reuse a healthy listener. Page exit
unsubscribes; operational-week changes replace subscriptions. Partial/cache-only
snapshots do not erase confirmed local records. Existing forms, restock controls,
supervisor actions and visual layout are retained.

Run isolated regression tests from the repository root:

```sh
node --test tests/phc-dashboard-live.test.mjs tests/phc-checklist-dashboard.test.mjs tests/dashboard-loading.test.mjs tests/dashboard-access.test.mjs tests/phc-summary.test.mjs
```

These tests use synthetic data and fake Firestore callbacks, not production writes.
The sections below describe the legacy Apps Script setup, not the Firebase V2 deployment.

## Fungsi

- PHC 1: 78 item dalam 7 kategori.
- PHC 2: 75 item dalam 6 kategori tanpa Dextrostix.
- Kuantiti tidak boleh melebihi standard item.
- Rekod dihantar ke Google Sheet melalui Google Apps Script.
- Sokongan offline: rekod disimpan sementara dan dihantar semula apabila talian tersedia.
- Dashboard harian, rekod mingguan dan amaran restock.
- PWA boleh dipasang dan digunakan secara responsif.

## Sambungan produksi

1. Import workbook `PHC_Google_Sheet_Production.xlsx` sebagai Google Sheet native.
2. Pasang kandungan folder `google-apps-script` sebagai Web app.
3. Masukkan URL deployment `/exec` dalam `js/config.js`.

Aplikasi PHC ini kekal berasingan daripada Dashboard AMO sehingga integrasi diarahkan.
