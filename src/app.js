const express = require("express");
const { apiKeyAuth } = require("./middleware/apiKeyAuth");
const { adminAuth } = require("./middleware/adminAuth");
const { createApiKey } = require("./services/apiKeyService");
const {
  enqueueNotification,
  getNotificationById,
  listNotifications
} = require("./services/notificationService");
const { isWhatsAppEnabled, isWhatsAppReady } = require("./services/whatsappService");

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.use((req, res, next) => {
    const startedAt = Date.now();

    res.on("finish", () => {
      const elapsedMs = Date.now() - startedAt;
      console.log(`[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${elapsedMs}ms)`);
    });

    next();
  });

  app.get("/health", (_req, res) => {
    const whatsappStatus = isWhatsAppEnabled()
      ? (isWhatsAppReady() ? "ready" : "initializing")
      : "disabled";

    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      whatsapp: whatsappStatus
    });
  });

  app.post("/notify", apiKeyAuth, asyncHandler(async (req, res) => {
    const idempotencyKey =
      (req.header("idempotency-key") || req.header("x-idempotency-key") || "").trim() || null;

    const notification = await enqueueNotification(req.body || {}, {
      apiKeyId: req.auth?.apiKeyId,
      idempotencyKey
    });

    const isReplay = Boolean(notification.idempotency_replayed);

    res.status(isReplay ? 200 : 202).json({
      message: isReplay ? "Notification replayed from idempotency cache" : "Notification accepted",
      notification
    });
  }));

  app.get("/notifications", apiKeyAuth, asyncHandler(async (req, res) => {
    const listing = await listNotifications({
      status: req.query.status,
      page: req.query.page,
      page_size: req.query.page_size
    });

    return res.json(listing);
  }));

  app.get("/notifications/:id", apiKeyAuth, asyncHandler(async (req, res) => {
    const rawId = String(req.params.id || "").trim();
    if (!/^\d+$/.test(rawId)) {
      return res.status(400).json({
        error: "Invalid notification id"
      });
    }

    const id = Number.parseInt(rawId, 10);

    const notification = await getNotificationById(id);
    if (!notification) {
      return res.status(404).json({
        error: "Notification not found"
      });
    }

    return res.json(notification);
  }));

  app.post("/admin/api-keys", adminAuth, asyncHandler(async (req, res) => {
    const label = String(req.body?.label || "admin-generated").trim();
    const created = await createApiKey(label || "admin-generated");

    res.status(201).json({
      message: "API key created",
      api_key: created.apiKey,
      label: created.label
    });
  }));

  app.use((error, _req, res, _next) => {
    const statusCode = Number.isFinite(error.statusCode) ? error.statusCode : 500;

    if (statusCode >= 500) {
      console.error("[api] Internal error:", error);
    }

    res.status(statusCode).json({
      error: statusCode >= 500 ? "Internal server error" : String(error.message || "Request error")
    });
  });

  return app;
}

module.exports = {
  createApp
};
