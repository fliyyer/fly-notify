# Testing Guide

Project ini belum punya unit test formal. Jalur test yang tersedia sekarang adalah syntax check dan smoke test untuk memastikan server, dashboard gateway, dan API inti tetap jalan.

## Prasyarat

- Node.js 18+.
- Dependency project sudah terpasang.
- Untuk test biasa, Chrome tidak wajib karena smoke test hanya memverifikasi gateway UI dan status bot. Integrasi WhatsApp tetap akan tampil `ready: false` jika browser Puppeteer belum tersedia.

## Instalasi

Gunakan:

```bash
make install
```

Target ini sengaja memakai `PUPPETEER_SKIP_DOWNLOAD=true` supaya instalasi tidak gagal di environment yang belum punya browser Puppeteer.

## Menjalankan Test

Jalankan semua test:

```bash
make test
```

Yang dijalankan:

- `make test-syntax`
  Memastikan `server.js`, `bot.js`, dan `data/database.js` valid secara sintaks.
- `make test-smoke`
  Menyalakan server di port test, mengecek route dashboard, endpoint JSON inti, dan mencoba generate API key bila bot sedang connect.

Kalau hanya ingin salah satu:

```bash
make test-syntax
make test-smoke
```

## Menjalankan Server Manual

```bash
make run
```

Server default berjalan di `http://localhost:3000`.

## Yang Diverifikasi Smoke Test

- Halaman `/dashboard` bisa dirender.
- Endpoint `/api/templates` merespons data template.
- Endpoint `/api/bot/status` merespons struktur status bot.
- Endpoint `/api/keys` merespons data API key.
- Flow create dan delete API key diuji saat bot sedang connect.

## Catatan WhatsApp Bot

Fitur WhatsApp Web masih bergantung pada Chrome/Puppeteer. Jadi kondisi berikut normal saat smoke test:

- Server hidup normal.
- Dashboard dan fitur gateway lolos.
- Status bot mengembalikan error browser belum tersedia.

Kalau ingin menguji integrasi WhatsApp juga, install browser Puppeteer atau Chrome yang kompatibel lalu jalankan server manual dan scan QR dari dashboard.
