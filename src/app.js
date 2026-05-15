const express = require("express");
const { apiKeyAuth } = require("./middleware/apiKeyAuth");
const { adminAuth } = require("./middleware/adminAuth");
const { 
  createApiKey, 
  listApiKeys, 
  toggleApiKey, 
  deleteApiKey 
} = require("./services/apiKeyService");
const {
  enqueueNotification,
  getNotificationById,
  listNotifications,
  getNotificationStats,
  resendAllFailedNotifications,
  getDailyStats,
  getSettings,
  updateSettings
} = require("./services/notificationService");
const { isWhatsAppEnabled, isWhatsAppReady } = require("./services/whatsappService");
const path = require("path");

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use(express.static(path.join(__dirname, "..", "public")));

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

  app.get("/admin/api-keys", adminAuth, asyncHandler(async (req, res) => {
    const keys = await listApiKeys();
    res.json(keys);
  }));

  app.post("/admin/api-keys", adminAuth, asyncHandler(async (req, res) => {
    const label = String(req.body?.label || "admin-generated").trim();
    const created = await createApiKey(label);

    res.status(201).json({
      message: "API key created",
      api_key: created.apiKey,
      label: created.label
    });
  }));

  app.post("/admin/api-keys/:id/toggle", adminAuth, asyncHandler(async (req, res) => {
    const updated = await toggleApiKey(req.params.id);
    res.json(updated);
  }));

  app.delete("/admin/api-keys/:id", adminAuth, asyncHandler(async (req, res) => {
    await deleteApiKey(req.params.id);
    res.json({ success: true });
  }));

  app.get("/admin/stats", adminAuth, asyncHandler(async (req, res) => {
    const stats = await getNotificationStats();
    res.json(stats);
  }));

  app.get("/admin/stats/daily", adminAuth, asyncHandler(async (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const stats = await getDailyStats(days);
    res.json(stats);
  }));

  app.get("/admin/notifications", adminAuth, asyncHandler(async (req, res) => {
    const listing = await listNotifications({
      status: req.query.status,
      page: req.query.page,
      page_size: req.query.page_size,
      search: req.query.search
    });
    res.json(listing);
  }));

  app.get("/admin/notifications/export", adminAuth, asyncHandler(async (req, res) => {
    console.log("[admin] Iniciando exportação CSV...");
    try {
      const { items } = await listNotifications({ page_size: 10000 });
      console.log(`[admin] ${items.length} notificações encontradas para exportar.`);
      
      let csv = "ID;Tipo;Destinatario;Assunto;Status;Tentativas;Criado Em;Enviado Em\n";
      for (const item of items) {
        const subject = (item.subject || "").replace(/"/g, '""');
        const recipient = (item.recipient || "").replace(/"/g, '""');
        csv += `${item.id};"${item.type}";"${recipient}";"${subject}";"${item.status}";${item.attempts};"${item.created_at}";"${item.sent_at || ""}"\n`;
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=notificacoes_export.csv");
      res.send(csv);
      console.log("[admin] Exportação CSV enviada com sucesso.");
    } catch (err) {
      console.error("[admin] Erro fatal na exportação:", err);
      res.status(500).json({ error: "Erro ao gerar arquivo CSV" });
    }
  }));

  app.get("/admin/notifications/:id", adminAuth, asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const notification = await getNotificationById(id);
    if (!notification) {
      return res.status(404).json({ error: "Notification not found" });
    }
    res.json(notification);
  }));

  app.get("/admin/settings", adminAuth, asyncHandler(async (req, res) => {
    const settings = await getSettings();
    res.json(settings);
  }));

  app.post("/admin/settings", adminAuth, asyncHandler(async (req, res) => {
    const updated = await updateSettings(req.body);
    res.json(updated);
  }));

  app.post("/admin/notifications/:id/resend", adminAuth, asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const updated = await resendNotification(id);
    res.json({
      message: "Notification scheduled for resend",
      notification: updated
    });
  }));

  app.post("/admin/notifications/resend-failed", adminAuth, asyncHandler(async (req, res) => {
    const result = await resendAllFailedNotifications();
    res.json({
      message: `${result.count} failed notifications scheduled for resend`,
      count: result.count
    });
  }));


  app.post("/admin/notifications/bulk", adminAuth, asyncHandler(async (req, res) => {
    const { recipients, services, subject, body } = req.body;
    
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: "Recipients array is required" });
    }
    if (!services || !Array.isArray(services) || services.length === 0) {
      return res.status(400).json({ error: "Services array is required" });
    }

    const uniqueRecipients = [...new Set(recipients.map(r => r.trim()).filter(r => r))];
    const results = [];
    const scheduleAt = new Date().toISOString();

    for (const to of uniqueRecipients) {
      for (const type of services) {
        try {
          const notification = await enqueueNotification({
            type,
            to,
            subject,
            body,
            schedule_at: scheduleAt
          }, { apiKeyId: null }); // Admin initiated
          results.push({ to, type, success: true, id: notification.id });
        } catch (err) {
          results.push({ to, type, success: false, error: err.message });
        }
      }
    }

    res.json({
      message: "Bulk send processed",
      results
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
