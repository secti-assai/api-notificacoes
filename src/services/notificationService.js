const crypto = require("crypto");
const config = require("../config");
const { getDb } = require("../db");
const { sendEmail } = require("./emailService");
const { sendWhatsAppMessage } = require("./whatsappService");

const SUPPORTED_TYPES = new Set(["email", "whatsapp"]);
const SUPPORTED_STATUSES = new Set(["pending", "sent", "failed"]);

function buildHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function buildBadRequest(message) {
  return buildHttpError(400, message);
}

function parseScheduleAt(scheduleAt) {
  if (scheduleAt === undefined || scheduleAt === null || scheduleAt === "") {
    throw buildBadRequest("Field 'schedule_at' is required");
  }

  const raw = String(scheduleAt).trim();
  let date;

  if (/^\d+$/.test(raw)) {
    const numeric = Number.parseInt(raw, 10);
    date = raw.length <= 10 ? new Date(numeric * 1000) : new Date(numeric);
  } else {
    date = new Date(scheduleAt);
  }

  if (Number.isNaN(date.getTime())) {
    throw buildBadRequest("Field 'schedule_at' must be a valid timestamp");
  }

  return date.toISOString();
}

function validateAndNormalizeNotification(payload) {
  const type = String(payload.type || "").trim().toLowerCase();
  if (!SUPPORTED_TYPES.has(type)) {
    throw buildBadRequest("Field 'type' must be 'whatsapp' or 'email'");
  }

  const to = String(payload.to || "").trim();
  if (!to) {
    throw buildBadRequest("Field 'to' is required");
  }

  const subject = String(payload.subject || "").trim();
  if (!subject) {
    throw buildBadRequest("Field 'subject' is required");
  }

  const body = String(payload.body || "").trim();
  if (!body) {
    throw buildBadRequest("Field 'body' is required");
  }

  const scheduleAtIso = parseScheduleAt(payload.schedule_at);

  return {
    type,
    to,
    subject,
    body,
    scheduleAtIso
  };
}

function normalizeIdempotencyKey(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length > 255) {
    throw buildBadRequest("Idempotency-Key is too long (max 255 chars)");
  }

  return normalized;
}

function buildPayloadHash(notification) {
  const payloadFingerprint = JSON.stringify([
    notification.type,
    notification.to,
    notification.subject,
    notification.body,
    notification.scheduleAtIso
  ]);

  return crypto
    .createHash("sha256")
    .update(payloadFingerprint)
    .digest("hex");
}

function normalizeNotificationRow(row) {
  if (!row) {
    return null;
  }

  const {
    payload_hash: _payloadHash,
    ...safeRow
  } = row;

  return {
    ...safeRow,
    to: safeRow.recipient
  };
}

async function getNotificationRowById(db, id) {
  return db.get(
    `
      SELECT
        id,
        type,
        recipient,
        subject,
        body,
        schedule_at,
        status,
        attempts,
        last_error,
        idempotency_key,
        created_at,
        sent_at,
        payload_hash
      FROM notifications
      WHERE id = ?
    `,
    [id]
  );
}

async function findNotificationByIdempotency(db, apiKeyId, idempotencyKey) {
  return db.get(
    `
      SELECT
        id,
        type,
        recipient,
        subject,
        body,
        schedule_at,
        status,
        attempts,
        last_error,
        idempotency_key,
        created_at,
        sent_at,
        payload_hash
      FROM notifications
      WHERE api_key_id = ? AND idempotency_key = ?
      LIMIT 1
    `,
    [apiKeyId, idempotencyKey]
  );
}

function parsePositiveInteger(value, fallback, fieldName) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw buildBadRequest(`Query '${fieldName}' must be a positive integer`);
  }

  return parsed;
}

async function enqueueNotification(payload, options = {}) {
  const db = await getDb();
  const normalized = validateAndNormalizeNotification(payload);
  const apiKeyId = Number.isFinite(options.apiKeyId) ? options.apiKeyId : null;
  const idempotencyKey = normalizeIdempotencyKey(options.idempotencyKey);
  const payloadHash = buildPayloadHash(normalized);

  if (idempotencyKey && !apiKeyId) {
    throw buildHttpError(500, "Authenticated API key context is required for idempotent requests");
  }

  if (idempotencyKey) {
    const existing = await findNotificationByIdempotency(db, apiKeyId, idempotencyKey);
    if (existing) {
      if (existing.payload_hash !== payloadHash) {
        throw buildHttpError(422, "Idempotency-Key already used with different payload");
      }

      return {
        ...normalizeNotificationRow(existing),
        idempotency_replayed: true
      };
    }
  }

  try {
    const result = await db.run(
      `
        INSERT INTO notifications (
          type,
          recipient,
          subject,
          body,
          schedule_at,
          status,
          api_key_id,
          idempotency_key,
          payload_hash
        )
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `,
      [
        normalized.type,
        normalized.to,
        normalized.subject,
        normalized.body,
        normalized.scheduleAtIso,
        apiKeyId,
        idempotencyKey,
        payloadHash
      ]
    );

    const created = await getNotificationRowById(db, result.lastID);

    console.log(
      `[queue] Enqueued notification id=${created.id} type=${created.type} recipient=${created.recipient} schedule_at=${created.schedule_at}`
    );

    return {
      ...normalizeNotificationRow(created),
      idempotency_replayed: false
    };
  } catch (error) {
    const isUniqueViolation = String(error.message || "").includes("UNIQUE");
    if (!idempotencyKey || !isUniqueViolation) {
      throw error;
    }

    const existing = await findNotificationByIdempotency(db, apiKeyId, idempotencyKey);
    if (!existing) {
      throw error;
    }

    if (existing.payload_hash !== payloadHash) {
      throw buildHttpError(422, "Idempotency-Key already used with different payload");
    }

    console.log(
      `[queue] Replayed idempotent notification id=${existing.id} key=${idempotencyKey}`
    );

    return {
      ...normalizeNotificationRow(existing),
      idempotency_replayed: true
    };
  }
}

async function getNotificationById(id) {
  const db = await getDb();
  const row = await getNotificationRowById(db, id);
  return normalizeNotificationRow(row);
}

async function listNotifications(filters = {}) {
  const db = await getDb();

  const rawStatus = String(filters.status || "").trim().toLowerCase();
  const status = rawStatus || null;

  if (status && !SUPPORTED_STATUSES.has(status)) {
    throw buildBadRequest("Query 'status' must be one of: pending, sent, failed");
  }

  const page = parsePositiveInteger(filters.page, 1, "page");
  const pageSize = parsePositiveInteger(filters.page_size ?? filters.pageSize, 20, "page_size");
  if (pageSize > 100) {
    throw buildBadRequest("Query 'page_size' must be <= 100");
  }

  const offset = (page - 1) * pageSize;

  const whereClause = status ? "WHERE status = ?" : "";
  const whereParams = status ? [status] : [];

  const totalRow = await db.get(
    `SELECT COUNT(1) AS total FROM notifications ${whereClause}`,
    whereParams
  );

  const rows = await db.all(
    `
      SELECT
        id,
        type,
        recipient,
        subject,
        body,
        schedule_at,
        status,
        attempts,
        last_error,
        idempotency_key,
        created_at,
        sent_at
      FROM notifications
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `,
    [...whereParams, pageSize, offset]
  );

  const total = Number(totalRow?.total || 0);
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

  return {
    items: rows.map(normalizeNotificationRow),
    pagination: {
      page,
      page_size: pageSize,
      total,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1
    },
    filters: {
      status
    }
  };
}

async function dispatchNotification(notification) {
  if (notification.type === "email") {
    await sendEmail({
      to: notification.recipient,
      subject: notification.subject,
      body: notification.body
    });
    return;
  }

  await sendWhatsAppMessage({
    to: notification.recipient,
    subject: notification.subject,
    body: notification.body
  });
}

async function processDueNotifications() {
  const db = await getDb();
  const nowIso = new Date().toISOString();

  const notifications = await db.all(
    `
      SELECT id, type, recipient, subject, body, schedule_at, attempts, created_at
      FROM notifications
      WHERE status = 'pending' AND schedule_at <= ?
      ORDER BY schedule_at ASC
      LIMIT ?
    `,
    [nowIso, config.worker.batchSize]
  );

  const summary = {
    processed: notifications.length,
    sent: 0,
    failed: 0,
    retried: 0
  };

  if (notifications.length > 0) {
    console.log(`[worker] Processing batch with ${notifications.length} notification(s).`);
  }

  for (const notification of notifications) {
    try {
      console.log(
        `[worker] Dispatching id=${notification.id} type=${notification.type} recipient=${notification.recipient} attempt=${notification.attempts + 1}`
      );

      // --- ANTISPAM: Limitação de envio e variabilidade para WhatsApp ---
      if (notification.type === "whatsapp") {
        // 1. Variabilidade (Spintax / Zero-width characters)
        // Adiciona um conjunto aleatório de caracteres de espaço-zero (invisíveis)
        // para que o hash da mensagem seja sempre diferente.
        const zeroWidthChars = ['\u200B', '\u200C', '\u200D', '\uFEFF'];
        const randomInvisibleSequence = Array.from({ length: 5 }, () => 
          zeroWidthChars[Math.floor(Math.random() * zeroWidthChars.length)]
        ).join('');
        notification.body = notification.body + randomInvisibleSequence;

        // 2. Atraso Aleatório (Delay)
        // Esperar entre 15 a 30 segundos entre cada envio do WhatsApp
        const delayMs = Math.floor(Math.random() * (30000 - 15000 + 1) + 15000);
        console.log(`[worker] Anti-spam: Aguardando ${delayMs}ms antes de enviar para ${notification.recipient}...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      await dispatchNotification(notification);

      await db.run(
        `
          UPDATE notifications
          SET status = 'sent', sent_at = ?, last_error = NULL
          WHERE id = ?
        `,
        [new Date().toISOString(), notification.id]
      );

      console.log(`[worker] Sent id=${notification.id}`);
      summary.sent += 1;
    } catch (error) {
      const nextAttempt = notification.attempts + 1;
      const shouldFail = nextAttempt >= config.worker.maxAttempts;
      const errorMessage = String(error.message || error);

      await db.run(
        `
          UPDATE notifications
          SET attempts = ?,
              status = ?,
              last_error = ?
          WHERE id = ?
        `,
        [
          nextAttempt,
          shouldFail ? "failed" : "pending",
          errorMessage,
          notification.id
        ]
      );

      if (shouldFail) {
        console.error(
          `[worker] Failed permanently id=${notification.id} attempts=${nextAttempt} error=${errorMessage}`
        );

        await db.run(
          `
            INSERT OR IGNORE INTO dead_letter_notifications (
              notification_id,
              type,
              recipient,
              subject,
              body,
              schedule_at,
              attempts,
              last_error,
              created_at,
              failed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            notification.id,
            notification.type,
            notification.recipient,
            notification.subject,
            notification.body,
            notification.schedule_at,
            nextAttempt,
            errorMessage,
            notification.created_at,
            new Date().toISOString()
          ]
        );

        summary.failed += 1;
      } else {
        console.warn(
          `[worker] Retry scheduled id=${notification.id} attempts=${nextAttempt}/${config.worker.maxAttempts} error=${errorMessage}`
        );

        summary.retried += 1;
      }
    }
  }

  return summary;
}

module.exports = {
  enqueueNotification,
  getNotificationById,
  listNotifications,
  processDueNotifications
};
