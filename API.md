# FlyNotify API

Dokumentasi ini untuk aplikasi client, termasuk Express app lain yang ingin memakai FlyNotify sebagai gateway WhatsApp.

## Prasyarat

- Bot WhatsApp sudah connect di dashboard.
- API key sudah digenerate dari dashboard.
- Server gateway berjalan, misalnya di `http://localhost:3000`.

## Generate API Key

API key hanya bisa dibuat saat bot sudah terhubung ke WhatsApp.

Di dashboard:

1. Buka `/dashboard`
2. Pastikan status bot `BOT CONNECTED`
3. Isi nama client app
4. Klik `Generate API Key`

## Endpoint Push

`POST /api/push`

Headers:

```http
Content-Type: application/json
x-api-key: YOUR_API_KEY
```

Body:

```json
{
  "to": "+14155550123",
  "recipientName": "Alya",
  "message": "Halo {name}, status terbaru sudah ready.",
  "variables": {
    "name": "Alya"
  }
}
```

Field:

- `to`: wajib. Nomor tujuan.
- `recipientName`: opsional. Nama penerima untuk log dan placeholder.
- `message`: wajib jika tidak memakai `templateId`.
- `templateId`: opsional. Gunakan template yang disimpan di dashboard.
- `variables`: opsional. Object untuk placeholder seperti `{name}`, `{reference}`, `{status}`, `{app}`.

## Format Nomor

Disarankan selalu memakai format internasional:

- `+14155550123`
- `+6281234567890`
- `00491515550123`

Kalau client mengirim nomor lokal seperti `081234567890`, gateway akan memakai `DEFAULT_COUNTRY_CODE` dari server.

Contoh:

```env
DEFAULT_COUNTRY_CODE=62
```

Artinya:

- `081234567890` akan dibaca sebagai `6281234567890`

Untuk multi-negara, format internasional dengan `+` adalah opsi paling aman.

## Contoh Express Client

```js
const express = require('express');

const app = express();
app.use(express.json());

app.post('/send-whatsapp', async (req, res) => {
  const response = await fetch('http://localhost:3000/api/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.WA_PUSH_API_KEY
    },
    body: JSON.stringify({
      to: req.body.to,
      recipientName: req.body.recipientName,
      message: req.body.message,
      variables: req.body.variables || {}
    })
  });

  const result = await response.json();
  res.status(response.status).json(result);
});

app.listen(4000, () => {
  console.log('Client app running on :4000');
});
```

## Contoh Dengan Template

```json
{
  "to": "+6281234567890",
  "recipientName": "Rama",
  "templateId": 2,
  "variables": {
    "name": "Rama",
    "reference": "INV-2026-001"
  }
}
```

## Response Sukses

```json
{
  "success": true,
  "result": {
    "success": true,
    "notif": {
      "recipientName": "Alya",
      "source": "api",
      "appName": "My Express App",
      "phone": "14155550123",
      "message": "Halo Alya, status terbaru sudah ready.",
      "status": "sent"
    }
  }
}
```

## Response Error Umum

- `401 API key tidak valid`
- `400 Field "to" wajib diisi`
- `400 Pesan tidak boleh kosong`
- `400 Bot belum siap. Scan QR terlebih dahulu.`
- `500 Nomor <number> tidak terdaftar di WhatsApp`
