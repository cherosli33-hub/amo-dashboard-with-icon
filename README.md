# A.M.O ETD LEPEH

Progressive Web App (PWA) untuk membuka dashboard **Log Prosedur A.M.O ETD Lepeh** daripada ikon Home Screen.

## URL aplikasi

`https://cherosli33-hub.github.io/amo-dashboard-with-icon/`

## Pasang pada telefon

- **Android / Chrome:** buka URL aplikasi, tekan menu, kemudian **Add to Home screen** atau **Install app**.
- **iPhone / Safari:** buka URL aplikasi, tekan **Share**, kemudian **Add to Home Screen**.

Apabila ikon aplikasi dibuka, pelancar akan menghala ke Google Apps Script `/exec` yang menyediakan dashboard. Sambungan internet diperlukan untuk data Google Sheet.

## GitHub Pages

Tetapkan **Settings > Pages > Build and deployment** kepada:

- Source: **Deploy from a branch**
- Branch: **main**
- Folder: **/ (root)**

Fail PWA berada terus di root repository.

## Nota teknikal

Apps Script menghantar polisi keselamatan yang menghalang paparan dalam `iframe` dari domain lain. Oleh itu, PWA ini membuka URL dashboard secara terus dan tidak mengubah sebarang fungsi Google Sheet atau Apps Script.
