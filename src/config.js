const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const rootDir = path.resolve(__dirname, "..");

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function toInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveProjectPath(inputPath, defaultRelativePath) {
  const targetPath = inputPath && String(inputPath).trim().length > 0
    ? String(inputPath).trim()
    : defaultRelativePath;

  return path.isAbsolute(targetPath)
    ? targetPath
    : path.join(rootDir, targetPath);
}

const config = {
  app: {
    env: process.env.NODE_ENV || "development",
    port: toInteger(process.env.PORT, 3000)
  },
  db: {
    filePath: resolveProjectPath(process.env.SQLITE_FILE, "./data/notifications.sqlite3")
  },
  logging: {
    filePath: resolveProjectPath(process.env.LOG_FILE, "./logs/processing.log")
  },
  auth: {
    apiKeyHeader: "x-api-key",
    adminHeader: "x-admin-token",
    adminToken: process.env.ADMIN_TOKEN || ""
  },
  worker: {
    cronExpression: process.env.WORKER_CRON || "* * * * *",
    batchSize: toInteger(process.env.WORKER_BATCH_SIZE, 50),
    maxAttempts: toInteger(process.env.WORKER_MAX_ATTEMPTS, 3)
  },
  smtp: {
    service: process.env.SMTP_SERVICE || "",
    host: process.env.SMTP_HOST || "",
    port: toInteger(process.env.SMTP_PORT, 587),
    secure: toBoolean(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || ""
  },
  whatsapp: {
    enabled: toBoolean(process.env.WHATSAPP_ENABLED, false),
    authPath: resolveProjectPath(process.env.WHATSAPP_AUTH_PATH, "./.wwebjs_auth"),
    clientId: process.env.WHATSAPP_CLIENT_ID || "central-notificacoes",
    defaultCountryCode: process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || "55",
    headless: toBoolean(process.env.WHATSAPP_HEADLESS, true),
    noSandbox: toBoolean(process.env.WHATSAPP_NO_SANDBOX, true)
  }
};

module.exports = config;
