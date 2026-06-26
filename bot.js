const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./data/database');

const clients = {};
const clientStatuses = {};
let io = null;

function setIO(socketIO) { io = socketIO; }

function getDevicesStatus() {
    const statuses = {};
    const devices = db.getDevices();
    for (const device of devices) {
        statuses[device.id] = clientStatuses[device.id] || {
            ready: false,
            hasQR: false,
            qr: null,
            info: null,
            error: null
        };
    }
    return statuses;
}

function getStatus(deviceId = 'default') {
    let targetId = deviceId;
    if (!clientStatuses[targetId]) {
        const keys = Object.keys(clientStatuses);
        if (keys.length > 0) targetId = keys[0];
    }
    return clientStatuses[targetId] || { ready: false, hasQR: false, info: null, qr: null, error: null };
}

function getCurrentQR(deviceId = 'default') {
    const status = getStatus(deviceId);
    return status.qr;
}

function emitDeviceStatus(deviceId) {
    const status = clientStatuses[deviceId] || { ready: false, hasQR: false, info: null, qr: null, error: null };
    if (io) {
        io.emit('device_status', { deviceId, status });
        io.emit('devices_status', getDevicesStatus());

        // Backward compatibility for single device integrations (if default or first device)
        const devices = db.getDevices();
        const firstId = devices.length > 0 ? devices[0].id : 'default';
        if (deviceId === firstId || deviceId === 'default') {
            io.emit('qr', { qr: status.qr, status: status.ready ? 'ready' : (status.qr ? 'qr' : 'offline') });
            if (status.ready) {
                io.emit('ready', { info: status.info });
            } else {
                io.emit('status', { status: status.qr ? 'qr' : 'disconnected', message: status.error });
            }
        }
    }
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

function initializeBot(deviceId) {
    console.log(`🤖 Initializing WhatsApp Bot for Device: ${deviceId}...`);
    lastError = null;

    if (clients[deviceId]) {
        try {
            clients[deviceId].destroy().catch(() => {});
        } catch (e) {}
        delete clients[deviceId];
    }

    const device = db.getDevice(deviceId);
    if (!device) {
        console.error(`Device not found in DB: ${deviceId}`);
        return;
    }

    clientStatuses[deviceId] = {
        ready: false,
        hasQR: false,
        qr: null,
        info: null,
        error: null
    };

    const executablePath = resolveChromeExecutable();
    
    // Clean old auth if requested
    if (process.env.CLEAN_SESSION === 'true') {
        const authPath = path.join(__dirname, '.wwebjs_auth', `session-${device.clientId}`);
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
        }
    }
    
    // Clean SingletonLock if exists to prevent Puppeteer "profile in use" error in Docker
    const sessionAuthPath = path.join(__dirname, '.wwebjs_auth', `session-${device.clientId}`);
    if (fs.existsSync(sessionAuthPath)) {
        try {
            const deleteLockFiles = (dir) => {
                if (!fs.existsSync(dir)) return;
                const files = fs.readdirSync(dir);
                for (const file of files) {
                    const fullPath = path.join(dir, file);
                    try {
                        const stat = fs.lstatSync(fullPath);
                        if (stat.isDirectory()) {
                            deleteLockFiles(fullPath);
                        } else if (file === 'SingletonLock') {
                            fs.unlinkSync(fullPath);
                            console.log(`Deleted SingletonLock: ${fullPath}`);
                        }
                    } catch (e) {
                        try {
                            fs.unlinkSync(fullPath);
                            console.log(`Deleted SingletonLock (fallback): ${fullPath}`);
                        } catch (unlinkErr) {}
                    }
                }
            };
            deleteLockFiles(sessionAuthPath);
        } catch (err) {
            console.warn(`Warning: Failed to clean SingletonLock for ${deviceId}:`, err.message);
        }
    }
    
    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: device.clientId,
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

    clients[deviceId] = client;
    
    client.on('qr', async (qr) => {
        console.log(`📱 QR Code received for device ${device.name || deviceId}`);
        try {
            const qrCodeData = await qrcode.toDataURL(qr, {
                width: 400,
                margin: 2,
                color: { dark: '#000000', light: '#FFFFFF' }
            });
            clientStatuses[deviceId].qr = qrCodeData;
            clientStatuses[deviceId].hasQR = true;
            clientStatuses[deviceId].ready = false;
            clientStatuses[deviceId].error = null;
            emitDeviceStatus(deviceId);
        } catch (e) {
            console.error('QR error:', e.message);
        }
    });
    
    client.on('authenticated', () => {
        console.log(`✅ Authenticated device ${device.name || deviceId}`);
        clientStatuses[deviceId].error = null;
        emitDeviceStatus(deviceId);
    });
    
    client.on('auth_failure', (msg) => {
        console.error(`❌ Auth failed for device ${device.name || deviceId}:`, msg);
        clientStatuses[deviceId].error = msg;
        emitDeviceStatus(deviceId);
    });
    
    client.on('ready', async () => {
        clientStatuses[deviceId].ready = true;
        clientStatuses[deviceId].qr = null;
        clientStatuses[deviceId].hasQR = false;
        clientStatuses[deviceId].error = null;
        try {
            clientStatuses[deviceId].info = {
                name: client.info.pushname,
                number: client.info.wid.user,
                platform: client.info.platform
            };
            db.updateDevice(deviceId, {
                phoneNumber: client.info.wid.user,
                pushName: client.info.pushname
            });
        } catch(e) {
            clientStatuses[deviceId].info = { name: 'Unknown', number: 'Unknown' };
        }
        console.log(`✅ Bot ready for device ${device.name || deviceId}!`);
        emitDeviceStatus(deviceId);
    });
    
    client.on('disconnected', (reason) => {
        clientStatuses[deviceId].ready = false;
        clientStatuses[deviceId].info = null;
        clientStatuses[deviceId].error = typeof reason === 'string' ? reason : 'Bot disconnected';
        console.log(`❌ Disconnected device ${device.name || deviceId}:`, reason);
        emitDeviceStatus(deviceId);
        
        if (reason === 'LOGOUT') {
            console.log(`Session was logged out for device ${device.name || deviceId}. Cleaning up session files...`);
            try {
                client.destroy().catch(() => {});
            } catch (e) {}
            delete clients[deviceId];
            
            const authPath = path.join(__dirname, '.wwebjs_auth', `session-${device.clientId}`);
            if (fs.existsSync(authPath)) {
                try {
                    fs.rmSync(authPath, { recursive: true, force: true });
                } catch (fsErr) {
                    console.error('Failed to delete auth path on logout:', fsErr.message);
                }
            }
            db.updateDevice(deviceId, {
                phoneNumber: '',
                pushName: ''
            });
            setTimeout(() => initializeBot(deviceId), 2000);
        }
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
        clientStatuses[deviceId].ready = false;
        clientStatuses[deviceId].info = null;
        clientStatuses[deviceId].qr = null;
        clientStatuses[deviceId].hasQR = false;
        clientStatuses[deviceId].error = err.message;
        console.error(`Init error for device ${device.name || deviceId}:`, err.message);
        emitDeviceStatus(deviceId);
    });
}

function initializeAllBots() {
    db.loadDB();
    const devices = db.getDevices();
    console.log(`🤖 Initializing all WhatsApp bots... Found ${devices.length} devices.`);
    for (const device of devices) {
        initializeBot(device.id);
    }
}

function getActiveClient(preferredDeviceId) {
    if (preferredDeviceId && preferredDeviceId !== 'auto') {
        const client = clients[preferredDeviceId];
        const status = clientStatuses[preferredDeviceId];
        if (client && status && status.ready) {
            return { client, deviceId: preferredDeviceId };
        }
        throw new Error(`WhatsApp Device "${preferredDeviceId}" tidak aktif atau tidak terhubung`);
    }

    const readyDeviceIds = Object.keys(clientStatuses).filter(id => clientStatuses[id]?.ready);
    if (readyDeviceIds.length === 0) {
        throw new Error('Tidak ada WhatsApp Device yang aktif. Hubungkan setidaknya satu WhatsApp account.');
    }
    
    const deviceId = readyDeviceIds[0];
    return { client: clients[deviceId], deviceId };
}

async function sendNotification(booking, templateMessage, preferredDeviceId) {
    const clientObj = getActiveClient(preferredDeviceId);
    const client = clientObj.client;
    const deviceId = clientObj.deviceId;
    const device = db.getDevice(deviceId);
    const deviceName = device ? device.name : 'Unknown Device';

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
        status: 'sent',
        senderDevice: `${deviceName} (+${client.info.wid.user})`
    });
    
    if (io) io.emit('notification_sent', notif);
    return { success: true, notif };
}

async function sendDirectMessage(payload) {
    const preferredDeviceId = payload.deviceId || payload.preferredDeviceId;
    const clientObj = getActiveClient(preferredDeviceId);
    const client = clientObj.client;
    const deviceId = clientObj.deviceId;
    const device = db.getDevice(deviceId);
    const deviceName = device ? device.name : 'Unknown Device';

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
        meta: payload.meta || null,
        senderDevice: `${deviceName} (+${client.info.wid.user})`
    });

    if (io) io.emit('notification_sent', notif);
    return { success: true, notif };
}

async function sendBulk(bookings, templateMessage, preferredDeviceId) {
    const results = [];
    const settings = db.getSettings();
    
    for (let i = 0; i < bookings.length; i++) {
        try {
            const result = await sendNotification(bookings[i], templateMessage, preferredDeviceId);
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

async function logoutBot(deviceId) {
    console.log(`🤖 Resetting session / Logging out device: ${deviceId}`);
    const client = clients[deviceId];
    const device = db.getDevice(deviceId);
    if (!device) return { success: false, error: 'Device not found' };

    try {
        if (client) {
            try {
                await client.logout();
            } catch (logoutErr) {
                console.warn('Warning: client.logout failed:', logoutErr.message);
            }
            try {
                await client.destroy();
            } catch (destroyErr) {
                console.warn('Warning: client.destroy failed:', destroyErr.message);
            }
        }
    } catch (e) {
        console.error('Error during client logout cleanup:', e.message);
    }

    delete clients[deviceId];

    try {
        const authPath = path.join(__dirname, '.wwebjs_auth', `session-${device.clientId}`);
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
        }
    } catch (fsErr) {
        console.error('Failed to delete auth path during logout:', fsErr.message);
    }

    if (clientStatuses[deviceId]) {
        clientStatuses[deviceId].ready = false;
        clientStatuses[deviceId].info = null;
        clientStatuses[deviceId].qr = null;
        clientStatuses[deviceId].hasQR = false;
        clientStatuses[deviceId].error = null;
    }

    db.updateDevice(deviceId, {
        phoneNumber: '',
        pushName: ''
    });

    emitDeviceStatus(deviceId);
    setTimeout(() => initializeBot(deviceId), 2000);
    return { success: true };
}

async function deleteBot(deviceId) {
    console.log(`🤖 Deleting bot for device: ${deviceId}`);
    const client = clients[deviceId];
    const device = db.getDevice(deviceId);
    
    try {
        if (client) {
            try {
                await client.destroy();
            } catch (destroyErr) {
                console.warn('Warning: client.destroy failed:', destroyErr.message);
            }
        }
    } catch (e) {
        console.error('Error during client destroy:', e.message);
    }

    delete clients[deviceId];
    delete clientStatuses[deviceId];

    if (device) {
        try {
            const authPath = path.join(__dirname, '.wwebjs_auth', `session-${device.clientId}`);
            if (fs.existsSync(authPath)) {
                fs.rmSync(authPath, { recursive: true, force: true });
            }
        } catch (fsErr) {
            console.error('Failed to delete auth path during bot deletion:', fsErr.message);
        }
        db.deleteDevice(deviceId);
    }

    if (io) {
        io.emit('devices_status', getDevicesStatus());
    }

    return { success: true };
}

module.exports = {
    initializeBot,
    initializeAllBots,
    sendNotification,
    sendDirectMessage,
    sendBulk,
    getStatus,
    getCurrentQR,
    setIO,
    logoutBot,
    deleteBot,
    getDevicesStatus
};
