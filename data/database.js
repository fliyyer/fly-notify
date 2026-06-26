const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

const dataDir = path.join(__dirname);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbFile = path.join(__dirname, 'db.json');

let database = {
    bookings: [],
    notifications: [],
    templates: [
        {
            id: 1,
            name: 'Welcome Ping',
            message: 'Halo {name},\n\nnotifikasi dari {app} sudah aktif. Pesan ini dikirim dari FlyNotify.'
        },
        {
            id: 2,
            name: 'Payment Reminder',
            message: 'Halo {name},\n\nkami mengingatkan bahwa ada pembayaran yang perlu diselesaikan hari ini.\n\nRef: {reference}'
        },
        {
            id: 3,
            name: 'Order Update',
            message: 'Halo {name},\n\nstatus terbaru untuk {reference}: {status}.\n\nCek dashboard Anda untuk detail lengkap.'
        }
    ],
    apiKeys: [],
    devices: [],
    settings: {
        botActive: true,
        senderName: 'FlyNotify',
        delay: 2000
    }
};

function generateApiKeyValue() {
    return `fly_${crypto.randomBytes(18).toString('hex')}`;
}

function loadDB() {
    try {
        if (fs.existsSync(dbFile)) {
            const data = fs.readFileSync(dbFile, 'utf8');
            database = JSON.parse(data);
            if (!database.templates) database.templates = [];
            if (!database.apiKeys) database.apiKeys = [];
            if (!database.devices) database.devices = [];
            if (!database.settings) database.settings = { botActive: true, senderName: 'FlyNotify', delay: 2000 };
            
            // Migrate existing single session config to "Default Device"
            if (database.devices.length === 0) {
                database.devices.push({
                    id: 'default',
                    name: 'Default Device',
                    clientId: config.sessionName || 'fly-notify-session',
                    phoneNumber: '',
                    pushName: '',
                    createdAt: new Date().toISOString()
                });
                fs.writeFileSync(dbFile, JSON.stringify(database, null, 2), 'utf8');
            }
        }
    } catch (e) {
        console.error('Error loading DB:', e.message);
    }
    return database;
}

function saveDB() {
    try {
        fs.writeFileSync(dbFile, JSON.stringify(database, null, 2), 'utf8');
    } catch (e) {
        console.error('Error saving DB:', e.message);
    }
}

module.exports = {
    loadDB,
    saveDB,
    getDB: () => database,
    addBooking: (booking) => {
        const nextBooking = {
            ...booking,
            id: Date.now(),
            createdAt: new Date().toISOString(),
            status: booking.status || 'pending',
            code: booking.code || `BK-${Date.now()}`
        };
        database.bookings.unshift(nextBooking);
        saveDB();
        return nextBooking;
    },
    getBookings: () => database.bookings,
    getBooking: (id) => database.bookings.find(b => b.id === id),
    updateBooking: (id, data) => {
        const idx = database.bookings.findIndex(b => b.id === id);
        if (idx !== -1) {
            database.bookings[idx] = { ...database.bookings[idx], ...data };
            saveDB();
            return database.bookings[idx];
        }
        return null;
    },
    deleteBooking: (id) => {
        database.bookings = database.bookings.filter(b => b.id !== id);
        saveDB();
    },
    addNotification: (notif) => {
        notif.id = Date.now() + Math.random();
        notif.sentAt = new Date().toISOString();
        database.notifications.unshift(notif);
        if (database.notifications.length > 500) {
            database.notifications = database.notifications.slice(0, 500);
        }
        saveDB();
        return notif;
    },
    getNotifications: () => database.notifications,
    getTemplates: () => database.templates,
    addTemplate: (template) => {
        template.id = Date.now();
        database.templates.push(template);
        saveDB();
        return template;
    },
    deleteTemplate: (id) => {
        database.templates = database.templates.filter(t => t.id !== id);
        saveDB();
    },
    getSettings: () => database.settings,
    updateSettings: (settings) => {
        database.settings = { ...database.settings, ...settings };
        saveDB();
        return database.settings;
    },
    getApiKeys: () => database.apiKeys,
    getApiKeyByValue: (value) => database.apiKeys.find((item) => item.key === value && item.active !== false),
    addApiKey: (name, deviceId) => {
        const apiKey = {
            id: Date.now(),
            name: name || 'Default App',
            key: generateApiKeyValue(),
            active: true,
            deviceId: deviceId || 'auto',
            createdAt: new Date().toISOString(),
            lastUsedAt: null
        };
        database.apiKeys.unshift(apiKey);
        saveDB();
        return apiKey;
    },
    touchApiKey: (id) => {
        const item = database.apiKeys.find((apiKey) => apiKey.id === id);
        if (!item) return null;
        item.lastUsedAt = new Date().toISOString();
        saveDB();
        return item;
    },
    deleteApiKey: (id) => {
        database.apiKeys = database.apiKeys.filter((item) => item.id !== id);
        saveDB();
    },
    getDevices: () => database.devices || [],
    getDevice: (id) => (database.devices || []).find(d => String(d.id) === String(id)),
    addDevice: (name) => {
        if (!database.devices) database.devices = [];
        const deviceId = `device_${Date.now()}`;
        const newDevice = {
            id: deviceId,
            name: name || 'New Device',
            clientId: deviceId,
            phoneNumber: '',
            pushName: '',
            createdAt: new Date().toISOString()
        };
        database.devices.push(newDevice);
        saveDB();
        return newDevice;
    },
    updateDevice: (id, data) => {
        if (!database.devices) database.devices = [];
        const idx = database.devices.findIndex(d => String(d.id) === String(id));
        if (idx !== -1) {
            database.devices[idx] = { ...database.devices[idx], ...data };
            saveDB();
            return database.devices[idx];
        }
        return null;
    },
    deleteDevice: (id) => {
        if (!database.devices) database.devices = [];
        const deleted = database.devices.find(d => String(d.id) === String(id));
        database.devices = database.devices.filter(d => String(d.id) !== String(id));
        saveDB();
        return deleted;
    }
};
