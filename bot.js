const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./data/database');

let client = null;
let qrCodeData = null;
let isReady = false;
let io = null;
let clientInfo = null;
let lastError = null;

function setIO(socketIO) { io = socketIO; }

function getStatus() {
    return { ready: isReady, hasQR: !!qrCodeData, info: clientInfo, qr: qrCodeData, error: lastError };
}

function normalizeWhatsAppNumber(phone) {
    const raw = String(phone || '').trim();
    if (!raw) return '';

    const normalizedRaw = raw.replace(/[^\d+]/g, '');
    if (normalizedRaw.startsWith('+')) {
        return normalizedRaw.slice(1);
    }

    if (normalizedRaw.startsWith('00')) {
        return normalizedRaw.slice(2);
    }

    const digits = normalizedRaw.replace(/\D/g, '');
    if (!digits) return '';

    if (raw.startsWith('0')) {
        return `${config.defaultCountryCode}${digits.slice(1)}`;
    }

    return digits;
}

function resolveChromeExecutable() {
    const envCandidates = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        process.env.CHROME_PATH
    ].filter(Boolean);

    const localCandidates = [
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        path.join(process.env.HOME || '', '.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome'),
        path.join(process.env.HOME || '', '.cache/puppeteer/chrome/linux-146.0.7680.153/chrome-linux64/chrome'),
        path.join(process.env.HOME || '', '.cache/puppeteer/chrome/linux-140.0.7339.82/chrome-linux64/chrome')
    ];

    return [...envCandidates, ...localCandidates].find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function initializeBot() {
    console.log('🤖 Initializing WhatsApp Bot...');
    lastError = null;
    const executablePath = resolveChromeExecutable();
    
    // Clean old auth if requested
    if (process.env.CLEAN_SESSION === 'true') {
        const authPath = path.join(__dirname, '.wwebjs_auth');
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
        }
    }
    
    client = new Client({
        authStrategy: new LocalAuth({
            clientId: config.sessionName,
            dataPath: path.join(__dirname, '.wwebjs_auth')
        }),
        puppeteer: {
            executablePath: executablePath || undefined,
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        }
    });
    
    client.on('qr', async (qr) => {
        console.log('📱 QR Code received');
        try {
            qrCodeData = await qrcode.toDataURL(qr, {
                width: 400,
                margin: 2,
                color: { dark: '#000000', light: '#FFFFFF' }
            });
            isReady = false;
            if (io) io.emit('qr', { qr: qrCodeData, status: 'qr' });
        } catch (e) {
            console.error('QR error:', e.message);
        }
    });
    
    client.on('authenticated', () => {
        console.log('✅ Authenticated');
        if (io) io.emit('status', { status: 'authenticated' });
    });
    
    client.on('auth_failure', (msg) => {
        console.error('❌ Auth failed:', msg);
        lastError = msg;
        if (io) io.emit('status', { status: 'auth_failure', message: msg });
    });
    
    client.on('ready', async () => {
        isReady = true;
        qrCodeData = null;
        try {
            clientInfo = {
                name: client.info.pushname,
                number: client.info.wid.user,
                platform: client.info.platform
            };
        } catch(e) { clientInfo = { name: 'Unknown', number: 'Unknown' }; }
        console.log('✅ Bot ready!');
        if (io) {
            io.emit('ready', { info: clientInfo });
            io.emit('qr', { qr: null, status: 'ready' });
        }
    });
    
    client.on('disconnected', (reason) => {
        isReady = false;
        clientInfo = null;
        lastError = typeof reason === 'string' ? reason : 'Bot disconnected';
        console.log('❌ Disconnected:', reason);
        if (io) io.emit('status', { status: 'disconnected', reason });
    });
    
    client.on('message', async (message) => {
        const text = message.body.toLowerCase().trim();
        if (text === 'ping') await message.reply('pong 🏓');
        else if (['halo', 'hai', 'hello'].includes(text)) {
            await message.reply('Halo! 👋 Gateway WhatsApp aktif. Ketik *menu* untuk pilihan.');
        } else if (text === 'menu') {
            await message.reply('*📋 MENU*\n\n1️⃣ *status* - Cek status gateway\n2️⃣ *bantuan* - Bantuan\n3️⃣ *kontak* - Kontak admin');
        } else if (text === 'status') {
            await message.reply('Gateway aktif dan siap menerima push notification.');
        } else if (text === 'bantuan') {
            await message.reply('*🆘 BANTUAN*\n\n📞 0812-xxxx-xxxx\n📧 support@wapush.local\n\nJam operasional: 08.00 - 20.00 WIB');
        }
    });
    
    client.initialize().catch(err => {
        isReady = false;
        clientInfo = null;
        qrCodeData = null;
        lastError = err.message;
        console.error('Init error:', err.message);
        if (io) io.emit('status', { status: 'init_error', message: err.message });
    });
}

async function sendNotification(booking, templateMessage) {
    if (!isReady) throw new Error('Bot belum siap. Scan QR terlebih dahulu.');
    
    const phone = normalizeWhatsAppNumber(booking.phone);
    if (!phone) throw new Error(`Nomor WhatsApp tidak valid untuk booking ${booking.name || booking.id}`);

    const numberId = await client.getNumberId(phone);
    if (!numberId || !numberId._serialized) {
        throw new Error(`Nomor ${phone} tidak terdaftar di WhatsApp`);
    }

    const chatId = numberId._serialized;
    
    let message = templateMessage
        .replace(/{name}/g, booking.name || 'Customer')
        .replace(/{service}/g, booking.service || '-')
        .replace(/{date}/g, booking.date || '-')
        .replace(/{time}/g, booking.time || '-')
        .replace(/{location}/g, booking.location || '-')
        .replace(/{code}/g, booking.code || '-');
    
    await client.sendMessage(chatId, message);
    
    const notif = db.addNotification({
        bookingId: booking.id,
        bookingName: booking.name,
        phone: phone,
        message: message,
        status: 'sent'
    });
    
    if (io) io.emit('notification_sent', notif);
    return { success: true, notif };
}

async function sendDirectMessage(payload) {
    if (!isReady) throw new Error('Bot belum siap. Scan QR terlebih dahulu.');

    const phone = normalizeWhatsAppNumber(payload.phone || payload.to);
    if (!phone) throw new Error('Nomor tujuan tidak valid');

    const numberId = await client.getNumberId(phone);
    if (!numberId || !numberId._serialized) {
        throw new Error(`Nomor ${phone} tidak terdaftar di WhatsApp`);
    }

    const chatId = numberId._serialized;
    const message = String(payload.message || '').trim();
    if (!message) throw new Error('Pesan tidak boleh kosong');

    await client.sendMessage(chatId, message);

    const notif = db.addNotification({
        recipientName: payload.name || payload.recipientName || 'Unknown recipient',
        source: payload.source || 'dashboard',
        appName: payload.appName || payload.source || 'Manual Push',
        phone,
        message,
        status: 'sent',
        meta: payload.meta || null
    });

    if (io) io.emit('notification_sent', notif);
    return { success: true, notif };
}

async function sendBulk(bookings, templateMessage) {
    const results = [];
    const settings = db.getSettings();
    
    for (let i = 0; i < bookings.length; i++) {
        try {
            const result = await sendNotification(bookings[i], templateMessage);
            results.push({ ...result, bookingId: bookings[i].id });
            if (io) io.emit('bulk_progress', { current: i + 1, total: bookings.length, success: true });
            if (i < bookings.length - 1) {
                await new Promise(r => setTimeout(r, settings.delay || config.notificationDelay));
            }
        } catch (e) {
            results.push({ success: false, error: e.message, bookingId: bookings[i].id });
            if (io) io.emit('bulk_progress', { current: i + 1, total: bookings.length, success: false, error: e.message });
        }
    }
    return results;
}

async function logoutBot() {
    try {
        if (client) {
            await client.logout();
            await client.destroy();
        }
        const authPath = path.join(__dirname, '.wwebjs_auth');
        if (fs.existsSync(authPath)) fs.rmSync(authPath, { recursive: true, force: true });
        isReady = false;
        clientInfo = null;
        qrCodeData = null;
        lastError = null;
        setTimeout(() => initializeBot(), 2000);
        return { success: true };
    } catch (e) {
        lastError = e.message;
        return { success: false, error: e.message };
    }
}

function getCurrentQR() { return qrCodeData; }

module.exports = { initializeBot, sendNotification, sendDirectMessage, sendBulk, getStatus, getCurrentQR, setIO, logoutBot };
