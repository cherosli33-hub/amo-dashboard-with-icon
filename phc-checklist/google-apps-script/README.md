# PHC Checklist — Google Apps Script

1. Import `PHC_Google_Sheet_Production.xlsx` sebagai Google Sheet native dalam akaun pemilik.
2. Cipta projek Apps Script menggunakan `Code.gs` dan `appsscript.json` ini.
3. Jalankan `setupSpreadsheetId('ID_GOOGLE_SHEET')` sekali dan benarkan akses.
4. Deploy sebagai Web app: execute as pemilik, access `Anyone`.
5. Salin URL `/exec` ke `APPS_SCRIPT_URL` dalam `js/config.js`.

API menyemak beg, shift, bilangan item, nama item, kuantiti standard dan had maksimum sebelum menulis data. ID pemeriksaan yang sama tidak akan ditulis dua kali.
