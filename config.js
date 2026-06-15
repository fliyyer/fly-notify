const path = require("path");

module.exports = {
  port: process.env.PORT || 3000,
  sessionName: process.env.SESSION_NAME || "wa-push-gateway-session",
  adminPassword: process.env.ADMIN_PASSWORD || "admin123",
  jwtSecret: process.env.JWT_SECRET || "wa-push-gateway-secret-2026",
  defaultCountryCode:
    String(process.env.DEFAULT_COUNTRY_CODE || "62").replace(/\D/g, "") || "62",
  notificationDelay: parseInt(process.env.NOTIFICATION_DELAY) || 2000,
  maxRetry: parseInt(process.env.MAX_RETRY) || 3,
  authFile: path.join(__dirname, ".wwebjs_auth"),
  publicDir: path.join(__dirname, "public"),
  viewsDir: path.join(__dirname, "views"),
  uploadsDir: path.join(__dirname, "public/uploads"),
};
