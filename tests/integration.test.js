const assert = require("node:assert/strict");
const { test, before, beforeEach, after } = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const tempDbFile = path.join(
  os.tmpdir(),
  `central-notificacoes-test-${process.pid}-${Date.now()}.sqlite3`
);

process.env.NODE_ENV = "test";
process.env.SQLITE_FILE = tempDbFile;
process.env.SMTP_SERVICE = "";
process.env.SMTP_HOST = "";
process.env.SMTP_USER = "";
process.env.SMTP_PASS = "";
process.env.WHATSAPP_ENABLED = "false";
process.env.WORKER_MAX_ATTEMPTS = "2";
process.env.ADMIN_TOKEN = "test-admin-token";

const { createApp } = require("../src/app");
const { getDb, closeDb } = require("../src/db");
const { createApiKey } = require("../src/services/apiKeyService");
const { processDueNotifications } = require("../src/services/notificationService");

let db;
let server;
let baseUrl;
let apiKey;

async function removeIfExists(filePath) {
  try {
    await fs.rm(filePath, { force: true });
  } catch (_error) {
    // Ignore cleanup errors for non-existent files.
  }
}

function buildHeaders(extraHeaders = {}) {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    ...extraHeaders
  };
}

before(async () => {
  db = await getDb();

  const app = createApp();
  server = await new Promise((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  await db.run("DELETE FROM dead_letter_notifications");
  await db.run("DELETE FROM notifications");
  await db.run("DELETE FROM api_keys");

  const created = await createApiKey("test-suite");
  apiKey = created.apiKey;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  await closeDb();

  await removeIfExists(tempDbFile);
  await removeIfExists(`${tempDbFile}-wal`);
  await removeIfExists(`${tempDbFile}-shm`);
});

test("GET /health should return service status", async () => {
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.status, "ok");
  assert.equal(payload.whatsapp, "disabled");
});

test("POST /notify should require x-api-key", async () => {
  const response = await fetch(`${baseUrl}/notify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      type: "email",
      to: "destino@exemplo.com",
      subject: "Teste",
      body: "Mensagem",
      schedule_at: new Date().toISOString()
    })
  });

  assert.equal(response.status, 401);

  const payload = await response.json();
  assert.equal(payload.error, "Missing x-api-key header");
});

test("POST /notify and GET /notifications/:id should enqueue and read notification", async () => {
  const scheduleAt = new Date(Date.now() + 60_000).toISOString();

  const enqueueResponse = await fetch(`${baseUrl}/notify`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      type: "email",
      to: "destino@exemplo.com",
      subject: "Assunto de teste",
      body: "Mensagem de teste",
      schedule_at: scheduleAt
    })
  });

  assert.equal(enqueueResponse.status, 202);

  const enqueuePayload = await enqueueResponse.json();
  assert.equal(enqueuePayload.notification.status, "pending");
  assert.equal(enqueuePayload.notification.to, "destino@exemplo.com");
  assert.equal(enqueuePayload.notification.idempotency_replayed, false);

  const notificationId = enqueuePayload.notification.id;

  const readResponse = await fetch(`${baseUrl}/notifications/${notificationId}`, {
    headers: buildHeaders()
  });

  assert.equal(readResponse.status, 200);

  const notification = await readResponse.json();
  assert.equal(notification.id, notificationId);
  assert.equal(notification.type, "email");
  assert.equal(notification.status, "pending");
  assert.equal(notification.recipient, "destino@exemplo.com");
  assert.equal(notification.to, "destino@exemplo.com");
});

test("GET /notifications should list paginated notifications filtered by status", async () => {
  const scheduleAt = new Date(Date.now() + 60_000).toISOString();

  const firstCreate = await fetch(`${baseUrl}/notify`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      type: "email",
      to: "pending@exemplo.com",
      subject: "Pendente",
      body: "Fila pendente",
      schedule_at: scheduleAt
    })
  });
  assert.equal(firstCreate.status, 202);
  const firstPayload = await firstCreate.json();

  const secondCreate = await fetch(`${baseUrl}/notify`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      type: "email",
      to: "sent@exemplo.com",
      subject: "Enviado",
      body: "Fila enviada",
      schedule_at: scheduleAt
    })
  });
  assert.equal(secondCreate.status, 202);
  const secondPayload = await secondCreate.json();

  await db.run("UPDATE notifications SET status = 'sent' WHERE id = ?", [
    secondPayload.notification.id
  ]);

  const listResponse = await fetch(`${baseUrl}/notifications?status=pending&page=1&page_size=10`, {
    headers: buildHeaders()
  });

  assert.equal(listResponse.status, 200);
  const listPayload = await listResponse.json();

  assert.equal(Array.isArray(listPayload.items), true);
  assert.equal(listPayload.items.length, 1);
  assert.equal(listPayload.items[0].id, firstPayload.notification.id);
  assert.equal(listPayload.pagination.total, 1);
  assert.equal(listPayload.pagination.page, 1);
  assert.equal(listPayload.pagination.page_size, 10);
  assert.equal(listPayload.filters.status, "pending");
});

test("POST /notify should replay request for same Idempotency-Key and payload", async () => {
  const scheduleAt = new Date(Date.now() + 60_000).toISOString();
  const idempotencyKey = `idem-${Date.now()}-same`;

  const requestBody = {
    type: "email",
    to: "idem@exemplo.com",
    subject: "Idempotencia",
    body: "Mesmo payload",
    schedule_at: scheduleAt
  };

  const firstResponse = await fetch(`${baseUrl}/notify`, {
    method: "POST",
    headers: buildHeaders({
      "Idempotency-Key": idempotencyKey
    }),
    body: JSON.stringify(requestBody)
  });

  const secondResponse = await fetch(`${baseUrl}/notify`, {
    method: "POST",
    headers: buildHeaders({
      "Idempotency-Key": idempotencyKey
    }),
    body: JSON.stringify(requestBody)
  });

  assert.equal(firstResponse.status, 202);
  assert.equal(secondResponse.status, 200);

  const firstPayload = await firstResponse.json();
  const secondPayload = await secondResponse.json();

  assert.equal(firstPayload.notification.idempotency_replayed, false);
  assert.equal(secondPayload.notification.idempotency_replayed, true);
  assert.equal(firstPayload.notification.id, secondPayload.notification.id);

  const countRow = await db.get("SELECT COUNT(1) AS total FROM notifications");
  assert.equal(countRow.total, 1);
});

test("POST /notify should reject reused Idempotency-Key with different payload", async () => {
  const scheduleAt = new Date(Date.now() + 60_000).toISOString();
  const idempotencyKey = `idem-${Date.now()}-different`;

  const firstResponse = await fetch(`${baseUrl}/notify`, {
    method: "POST",
    headers: buildHeaders({
      "Idempotency-Key": idempotencyKey
    }),
    body: JSON.stringify({
      type: "email",
      to: "idem@exemplo.com",
      subject: "Primeiro payload",
      body: "A",
      schedule_at: scheduleAt
    })
  });
  assert.equal(firstResponse.status, 202);

  const secondResponse = await fetch(`${baseUrl}/notify`, {
    method: "POST",
    headers: buildHeaders({
      "Idempotency-Key": idempotencyKey
    }),
    body: JSON.stringify({
      type: "email",
      to: "idem@exemplo.com",
      subject: "Segundo payload",
      body: "B",
      schedule_at: scheduleAt
    })
  });

  assert.equal(secondResponse.status, 422);
  const secondPayload = await secondResponse.json();
  assert.equal(secondPayload.error, "Idempotency-Key already used with different payload");
});

test("GET /notifications/:id should validate malformed ids", async () => {
  const response = await fetch(`${baseUrl}/notifications/12abc`, {
    headers: buildHeaders()
  });

  assert.equal(response.status, 400);

  const payload = await response.json();
  assert.equal(payload.error, "Invalid notification id");
});

test("POST /admin/api-keys should create keys with valid admin token", async () => {
  const response = await fetch(`${baseUrl}/admin/api-keys`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": "test-admin-token"
    },
    body: JSON.stringify({
      label: "erp-backoffice"
    })
  });

  assert.equal(response.status, 201);

  const payload = await response.json();
  assert.equal(payload.message, "API key created");
  assert.equal(payload.label, "erp-backoffice");
  assert.ok(payload.api_key.startsWith("nfy_"));
});

test("Worker should retry and then fail notification after max attempts", async () => {
  const dueTimestamp = new Date(Date.now() - 5_000).toISOString();

  const enqueueResponse = await fetch(`${baseUrl}/notify`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      type: "email",
      to: "destino@exemplo.com",
      subject: "Tentativa envio",
      body: "Sem SMTP configurado",
      schedule_at: dueTimestamp
    })
  });

  assert.equal(enqueueResponse.status, 202);
  const enqueuePayload = await enqueueResponse.json();
  const notificationId = enqueuePayload.notification.id;

  const summaryFirstRun = await processDueNotifications();
  assert.equal(summaryFirstRun.processed, 1);
  assert.equal(summaryFirstRun.retried, 1);
  assert.equal(summaryFirstRun.failed, 0);

  const firstReadResponse = await fetch(`${baseUrl}/notifications/${notificationId}`, {
    headers: buildHeaders()
  });
  const firstReadPayload = await firstReadResponse.json();

  assert.equal(firstReadPayload.status, "pending");
  assert.equal(firstReadPayload.attempts, 1);

  const summarySecondRun = await processDueNotifications();
  assert.equal(summarySecondRun.processed, 1);
  assert.equal(summarySecondRun.retried, 0);
  assert.equal(summarySecondRun.failed, 1);

  const secondReadResponse = await fetch(`${baseUrl}/notifications/${notificationId}`, {
    headers: buildHeaders()
  });
  const secondReadPayload = await secondReadResponse.json();

  assert.equal(secondReadPayload.status, "failed");
  assert.equal(secondReadPayload.attempts, 2);
  assert.ok(String(secondReadPayload.last_error || "").includes("SMTP is not configured"));

  const dlqRow = await db.get(
    "SELECT notification_id, attempts, last_error FROM dead_letter_notifications WHERE notification_id = ?",
    [notificationId]
  );

  assert.ok(dlqRow);
  assert.equal(dlqRow.notification_id, notificationId);
  assert.equal(dlqRow.attempts, 2);
  assert.ok(String(dlqRow.last_error || "").includes("SMTP is not configured"));
});
