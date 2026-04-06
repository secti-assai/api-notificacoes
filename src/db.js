const fs = require("fs/promises");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const config = require("./config");

let dbInstance;

async function ensureColumnExists(db, tableName, columnName, columnDefinition) {
  const columns = await db.all(`PRAGMA table_info(${tableName})`);
  const hasColumn = columns.some((column) => column.name === columnName);
  if (hasColumn) {
    return;
  }

  await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
}

async function initializeSchema(db) {
  await db.exec("PRAGMA journal_mode = WAL;");
  await db.exec("PRAGMA foreign_keys = ON;");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_hash TEXT NOT NULL UNIQUE,
      label TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('email', 'whatsapp')),
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      schedule_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      api_key_id INTEGER,
      idempotency_key TEXT,
      payload_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT
    );

    CREATE TABLE IF NOT EXISTS dead_letter_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notification_id INTEGER NOT NULL UNIQUE,
      type TEXT NOT NULL,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      schedule_at TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      last_error TEXT,
      created_at TEXT,
      failed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_dlq_failed_at
      ON dead_letter_notifications (failed_at DESC);

    CREATE INDEX IF NOT EXISTS idx_notifications_status_schedule
      ON notifications (status, schedule_at);

    CREATE INDEX IF NOT EXISTS idx_notifications_status_created_at
      ON notifications (status, created_at DESC);
  `);

  await ensureColumnExists(db, "notifications", "api_key_id", "INTEGER");
  await ensureColumnExists(db, "notifications", "idempotency_key", "TEXT");
  await ensureColumnExists(db, "notifications", "payload_hash", "TEXT");

  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_api_key_idempotency
      ON notifications (api_key_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);
}

async function getDb() {
  if (dbInstance) {
    return dbInstance;
  }

  const dbDir = path.dirname(config.db.filePath);
  await fs.mkdir(dbDir, { recursive: true });

  dbInstance = await open({
    filename: config.db.filePath,
    driver: sqlite3.Database
  });

  await initializeSchema(dbInstance);
  return dbInstance;
}

async function closeDb() {
  if (!dbInstance) {
    return;
  }

  await dbInstance.close();
  dbInstance = null;
}

module.exports = {
  getDb,
  closeDb
};
