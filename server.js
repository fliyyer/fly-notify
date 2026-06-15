const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const QRReader = require('qrcode-reader');
const multer = require('multer');
const { Server } = require('socket.io');
const jimp = require('jimp');
const fs = require('fs');

const config = require('./config');
const db = require('./data/database');
const bot = require('./bot');

// Global exception and rejection handlers to prevent crashes in Docker/production
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('⚠️ Uncaught Exception thrown:', err);
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Setup
app.set('view engine', 'ejs');
app.set('views', config.viewsDir);
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(config.publicDir));

// Multer
if (!fs.existsSync(config.uploadsDir)) fs.mkdirSync(config.uploadsDir, { recursive: true });
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.uploadsDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ============ VIEW ROUTES ============

app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/dashboard', (req, res) => res.render('dashboard'));
app.get('/bookings', (req, res) => res.redirect('/dashboard'));
app.get('/send', (req, res) => res.render('send'));
app.get('/scan', (req, res) => res.render('scan'));
app.get('/templates', (req, res) => res.render('templates'));
app.get('/history', (req, res) => res.render('history'));

// ============ API ROUTES ============

app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === config.adminPassword) {
        const token = jwt.sign({ role: 'admin' }, config.jwtSecret, { expiresIn: '7d' });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, error: 'Password salah' });
    }
});

app.get('/api/bot/status', (req, res) => res.json(bot.getStatus()));

app.get('/api/bot/qr', (req, res) => {
    const qr = bot.getCurrentQR();
    if (qr) res.json({ success: true, qr });
    else res.json({ success: false, error: 'QR belum tersedia' });
});

app.post('/api/bot/logout', async (req, res) => res.json(await bot.logoutBot()));

function fillTemplate(message, variables) {
    return String(message || '').replace(/\{(\w+)\}/g, (_, key) => {
        const value = variables && Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : '';
        return value == null ? '' : String(value);
    });
}

// QR Generate
app.post('/api/qr/generate', async (req, res) => {
    try {
        const { data, title } = req.body;
        const qrDataUrl = await QRCode.toDataURL(JSON.stringify(data), {
            width: 300, margin: 2,
            color: { dark: '#1e3a8a', light: '#ffffff' }
        });
        res.json({ success: true, qr: qrDataUrl, title });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// QR Scan
app.post('/api/qr/scan', upload.single('qrImage'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'File tidak ditemukan' });
        const image = await jimp.read(req.file.path);
        const qr = new QRReader();
        const value = await new Promise((resolve, reject) => {
            qr.callback = (err, v) => err ? reject(err) : resolve(v);
            qr.decode(image.bitmap);
        });
        fs.unlinkSync(req.file.path);
        let parsed = null;
        try { parsed = JSON.parse(value.result); } catch(e) {}
        res.json({ success: true, data: value.result, parsed });
    } catch (e) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ success: false, error: 'QR tidak terbaca: ' + e.message });
    }
});

app.post('/api/send', async (req, res) => {
    try {
        const { numbers, name, templateId, customMessage, variables, appName } = req.body;
        const targets = Array.isArray(numbers)
            ? numbers
            : String(numbers || '')
                .split(/[\n,]/)
                .map((item) => item.trim())
                .filter(Boolean);

        if (targets.length === 0) {
            return res.status(400).json({ success: false, error: 'Masukkan minimal satu nomor tujuan' });
        }

        let message = customMessage;
        if (templateId) {
            const templates = db.getTemplates();
            const tpl = templates.find(t => t.id === templateId || String(t.id) === String(templateId));
            if (tpl) message = fillTemplate(tpl.message, { name, app: appName, ...variables });
        }
        if (!message) return res.status(400).json({ success: false, error: 'Pesan tidak boleh kosong' });

        const status = bot.getStatus();
        if (!status.ready) return res.status(400).json({ success: false, error: 'Bot belum siap' });

        const hydratedMessage = fillTemplate(message, { name, app: appName, ...variables });
        const results = [];
        for (const phone of targets) {
            try {
                const result = await bot.sendDirectMessage({
                    phone,
                    name: name || 'Manual Recipient',
                    message: hydratedMessage,
                    source: 'dashboard',
                    appName: appName || 'Dashboard Push'
                });
                results.push({ ...result, phone });
            } catch (error) {
                results.push({ success: false, phone, error: error.message });
            }
        }

        const success = results.filter(r => r.success).length;
        res.json({ success: true, results, totalSent: success, total: targets.length });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Templates
app.get('/api/templates', (req, res) => res.json(db.getTemplates()));
app.post('/api/templates', (req, res) => res.json({ success: true, template: db.addTemplate(req.body) }));
app.delete('/api/templates/:id', (req, res) => {
    db.deleteTemplate(parseInt(req.params.id));
    res.json({ success: true });
});

// Notifications
app.get('/api/notifications', (req, res) => res.json(db.getNotifications()));

// API Keys
app.get('/api/keys', (req, res) => res.json(db.getApiKeys()));
app.post('/api/keys', (req, res) => {
    const status = bot.getStatus();
    if (!status.ready) {
        return res.status(400).json({ success: false, error: 'Hubungkan bot WhatsApp dulu sebelum generate API key' });
    }
    const key = db.addApiKey(req.body.name);
    res.json({ success: true, apiKey: key });
});
app.delete('/api/keys/:id', (req, res) => {
    db.deleteApiKey(parseInt(req.params.id, 10));
    res.json({ success: true });
});

// Third-party Push Endpoint
app.post('/api/push', async (req, res) => {
    try {
        const apiKeyValue = req.headers['x-api-key'] || req.body.apiKey;
        const apiKey = db.getApiKeyByValue(apiKeyValue);
        if (!apiKey) {
            return res.status(401).json({ success: false, error: 'API key tidak valid' });
        }

        const { to, message, recipientName, variables, templateId } = req.body;
        if (!to) return res.status(400).json({ success: false, error: 'Field "to" wajib diisi' });

        let finalMessage = message;
        if (templateId) {
            const templates = db.getTemplates();
            const tpl = templates.find(t => t.id === templateId || String(t.id) === String(templateId));
            if (tpl) finalMessage = tpl.message;
        }
        finalMessage = fillTemplate(finalMessage, {
            name: recipientName,
            app: apiKey.name,
            ...variables
        });
        if (!finalMessage) return res.status(400).json({ success: false, error: 'Pesan tidak boleh kosong' });

        const result = await bot.sendDirectMessage({
            phone: to,
            name: recipientName || 'API Recipient',
            message: finalMessage,
            source: 'api',
            appName: apiKey.name,
            meta: { templateId: templateId || null }
        });

        db.touchApiKey(apiKey.id);
        res.json({ success: true, result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Settings
app.get('/api/settings', (req, res) => res.json(db.getSettings()));
app.put('/api/settings', (req, res) => res.json({ success: true, settings: db.updateSettings(req.body) }));

// Stats
app.get('/api/stats', (req, res) => {
    const notifs = db.getNotifications();
    const apiKeys = db.getApiKeys();
    const templates = db.getTemplates();
    const today = new Date().toDateString();
    res.json({
        totalSent: notifs.length,
        todaySent: notifs.filter(n => new Date(n.sentAt).toDateString() === today).length,
        apiKeyCount: apiKeys.length,
        templateCount: templates.length,
        activeApiKeys: apiKeys.filter(k => k.active !== false).length
    });
});

// ============ SOCKET.IO ============

io.on('connection', (socket) => {
    const status = bot.getStatus();
    if (status.hasQR) socket.emit('qr', { qr: bot.getCurrentQR(), status: 'qr' });
    else if (status.ready) socket.emit('ready', { info: status.info });
    
    socket.on('disconnect', () => {});
});

// ============ START ============

db.loadDB();
bot.setIO(io);

server.listen(config.port, () => {
    console.log(`🌐 Server: http://localhost:${config.port}`);
    console.log(`📋 Dashboard: http://localhost:${config.port}/dashboard`);
    setTimeout(() => bot.initializeBot(), 1500);
});
