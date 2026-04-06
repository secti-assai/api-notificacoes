const config = require("./config");
const { createApp } = require("./app");
const { getDb, closeDb } = require("./db");
const { isEmailConfigured, verifyEmailTransport } = require("./services/emailService");
const {
  isWhatsAppEnabled,
  initializeWhatsAppClient,
  shutdownWhatsAppClient
} = require("./services/whatsappService");
const {
  initializeFileLogger,
  shutdownFileLogger
} = require("./services/loggerService");
const { startNotificationWorker } = require("./workers/notificationWorker");

async function bootstrap() {
  await initializeFileLogger();

  await getDb();
  console.log("[bootstrap] SQLite initialized.");

  if (isEmailConfigured()) {
    try {
      await verifyEmailTransport();
      console.log("[bootstrap] SMTP configuration verified.");
    } catch (error) {
      console.warn("[bootstrap] SMTP verify failed. Email sends may fail:", error.message);
    }
  } else {
    console.warn("[bootstrap] SMTP not fully configured. Email sending is disabled.");
  }

  if (isWhatsAppEnabled()) {
    initializeWhatsAppClient().catch((error) => {
      console.error("[bootstrap] WhatsApp initialization failed:", error.message);
    });
  } else {
    console.warn("[bootstrap] WhatsApp is disabled (WHATSAPP_ENABLED=false).");
  }

  const app = createApp();
  const worker = startNotificationWorker();

  const server = app.listen(config.app.port, () => {
    console.log(`[bootstrap] API listening on port ${config.app.port}`);
  });

  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    console.log(`[shutdown] Received ${signal}, stopping services...`);

    try {
      worker.stop();

      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      await shutdownWhatsAppClient();
      await closeDb();
      await shutdownFileLogger();

      console.log("[shutdown] Completed successfully.");
      process.exit(0);
    } catch (error) {
      console.error("[shutdown] Failed:", error);
      await shutdownFileLogger().catch(() => {});
      process.exit(1);
    }
  }

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

bootstrap().catch((error) => {
  console.error("[bootstrap] Fatal startup error:", error);
  shutdownFileLogger().catch(() => {});
  process.exit(1);
});
