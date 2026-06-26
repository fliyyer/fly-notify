# 🚀 FlyNotify - Multi-Device WhatsApp Push Gateway

FlyNotify adalah gateway WhatsApp push notification modern dan mandiri (self-hosted) yang memungkinkan Anda menghubungkan **beberapa nomor WhatsApp sekaligus** (multi-device) untuk mengirimkan notifikasi transaksi, booking reminder, OTP, dan pesan kustom dari aplikasi pihak ketiga secara instan dan andal.

---

## ✨ Fitur Utama

- 📱 **Multi-Device WhatsApp Support**: Hubungkan dan kelola beberapa akun WhatsApp secara bersamaan dalam satu panel.
- ⚡ **Real-time Status Sync**: Sinkronisasi status koneksi, pairing QR code, dan log pengiriman secara real-time menggunakan WebSockets (Socket.io).
- 🔐 **API Key Device Binding**: Generate API key untuk aplikasi klien Anda dan ikat secara spesifik ke device WhatsApp tertentu atau gunakan routing otomatis.
- 💬 **Kirim Pesan Manual & Massal (Bulk)**: Panel pengiriman pesan manual (tulis langsung atau pakai template) dengan dukungan pengiriman massal ter-delay untuk mencegah ban.
- 📋 **Template Engine**: Kelola template pesan dengan placeholder dinamis seperti `{name}`, `{app}`, `{code}`, `{date}`, dll.
- 📜 **Log Riwayat Pengiriman**: Riwayat pengiriman yang lengkap, mencatat status pesan, penerima, dan device WhatsApp mana yang digunakan untuk mengirim.
- 🐳 **Docker Ready**: Siap dijalankan dalam container Docker dengan Puppeteer headless terkonfigurasi.

---

## 🛠️ Persyaratan Sistem

- **Node.js**: v18 atau v20+
- **Google Chrome / Chromium**: Dibutuhkan oleh Puppeteer untuk menjalankan WhatsApp Web headless.
- **npm** atau **yarn**

---

## 🚀 Panduan Instalasi & Menjalankan

### Metode 1: Menjalankan Secara Lokal (Node.js)

1. **Clone Repository & Install Dependensi**:
   ```bash
   git clone <repo-url>
   cd wa-booking-bot
   npm install
   ```

2. **Konfigurasi Environment**:
   Salin file `.env.example` ke `.env` dan sesuaikan nilainya:
   ```bash
   cp .env.example .env
   ```
   *Isi `.env`*:
   ```env
   PORT=3000
   ADMIN_PASSWORD=admin123
   JWT_SECRET=your-secret-key-here
   DEFAULT_COUNTRY_CODE=62
   NOTIFICATION_DELAY=2000
   MAX_RETRY=3
   ```

3. **Jalankan Aplikasi**:
   ```bash
   npm start
   ```
   Aplikasi akan berjalan di:
   - Dashboard: [http://localhost:3000/dashboard](http://localhost:3000/dashboard)
   - Password login default: Sesuai isi `ADMIN_PASSWORD` di `.env`.

---

### Metode 2: Menggunakan Docker Compose

Jalankan gateway dalam satu perintah tanpa perlu menginstall Chrome secara lokal:
```bash
docker-compose up -d --build
```
Docker container sudah dilengkapi dengan Chromium dan dependensi sistem Linux yang diperlukan oleh Puppeteer.

---

## 📖 Cara Penggunaan Gateway

### 1. Menghubungkan Device WhatsApp
- Buka dashboard di browser Anda.
- Buka menu **Connect Bot** di sidebar.
- Klik **Add WhatsApp Device**, masukkan nama device (misal: "Customer Service").
- Pindai QR Code yang muncul menggunakan WhatsApp di HP Anda (Masuk ke **Linked Devices** > **Link a Device**).

### 2. Generate API Key
- Setelah WhatsApp terhubung, buka halaman **Dashboard**.
- Masukkan nama aplikasi klien (misal: "Billing App").
- Pilih device tujuan pengiriman (atau pilih "Otomatis" agar dicarikan device pertama yang aktif).
- Klik **Generate API Key** dan simpan key tersebut aman-aman.

### 3. Mengirim Notifikasi via API
Kirimkan HTTP POST request ke `/api/push` menggunakan API Key yang sudah dibuat:

```bash
curl -X POST http://localhost:3000/api/push \
  -H "Content-Type: application/json" \
  -H "x-api-key: fly_YOUR_API_KEY_HERE" \
  -d '{
    "to": "628123456789",
    "recipientName": "Budi",
    "message": "Halo {name}, invoice Anda untuk pemesanan {reference} telah lunas.",
    "variables": {
      "reference": "INV-2026-001"
    }
  }'
```

*Payload Parameters:*
| Parameter | Tipe | Wajib | Keterangan |
| :--- | :--- | :--- | :--- |
| `to` | String | Ya | Nomor WhatsApp tujuan (Format bebas: `0812...`, `62812...`, atau `+62812...`) |
| `recipientName` | String | Tidak | Nama penerima untuk mempopulasi placeholder `{name}` |
| `message` | String | Kondisional | Isi teks pesan. Wajib diisi jika tidak menggunakan `templateId` |
| `templateId` | Number/String| Kondisional | ID template pesan terdaftar di dashboard |
| `variables` | Object | Tidak | Kunci/nilai variabel kustom untuk mempopulasi placeholder pesan kustom |
| `deviceId` | String | Tidak | Paksa pengiriman melalui device ID tertentu (meng-override binding API Key) |

---

## 🧪 Pengujian & Syntax Check

Aplikasi ini dilengkapi dengan smoke test dan syntax check otomatis:
```bash
# Cek kesalahan sintaksis pada kode JS
npm run test:syntax

# Jalankan server testing untuk memverifikasi dashboard & fungsionalitas API
npm run test:smoke
```

---

## 📂 Struktur Project

```
├── config.js          # Konfigurasi sistem global
├── server.js          # HTTP routing Express & konfigurasi Socket.io
├── bot.js             # Runtime registry & manajemen instance WhatsApp Web
├── data/
│   ├── database.js    # Abstraksi penyimpanan data JSON lokal
│   └── db.json        # File database lokal (menyimpan bookings, keys, templates, dll.)
├── views/             # File template EJS untuk UI Dashboard
├── public/            # Aset statis (icons, uploads, dll.)
└── scripts/           # Smoke-testing scripts
```

---

## 📝 Lisensi
Proyek ini dilindungi di bawah lisensi MIT. Silakan kustomisasi dan gunakan secara bebas.
