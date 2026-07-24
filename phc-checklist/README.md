# PHC Checklist

Sistem pemeriksaan inventori Beg Pre Hospital Care untuk Hospital Kuala Lipis.

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
