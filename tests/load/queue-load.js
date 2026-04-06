const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const totalRequests = Number.parseInt(process.env.LOAD_TOTAL || "1000", 10);
const concurrency = Number.parseInt(process.env.LOAD_CONCURRENCY || "50", 10);
const scheduleOffsetMinutes = Number.parseInt(process.env.LOAD_SCHEDULE_OFFSET_MINUTES || "60", 10);

if (!Number.isFinite(totalRequests) || totalRequests < 1) {
  throw new Error("LOAD_TOTAL must be a positive integer");
}

if (!Number.isFinite(concurrency) || concurrency < 1) {
  throw new Error("LOAD_CONCURRENCY must be a positive integer");
}

if (!Number.isFinite(scheduleOffsetMinutes) || scheduleOffsetMinutes < 1) {
  throw new Error("LOAD_SCHEDULE_OFFSET_MINUTES must be a positive integer");
}

const tempDbFile = path.join(
  os.tmpdir(),
  `central-notificacoes-load-${process.pid}-${Date.now()}.sqlite3`
);

process.env.NODE_ENV = "test";
process.env.SQLITE_FILE = tempDbFile;
process.env.SMTP_SERVICE = "";
process.env.SMTP_HOST = "";
process.env.SMTP_USER = "";
process.env.SMTP_PASS = "";
process.env.WHATSAPP_ENABLED = "false";
process.env.ADMIN_TOKEN = "load-admin-token";

const { createApp } = require("../../src/app");
const { getDb, closeDb } = require("../../src/db");
const { createApiKey } = require("../../src/services/apiKeyService");

async function removeIfExists(filePath) {
  try {
    await fs.rm(filePath, { force: true });
  } catch (_error) {
    // Ignore cleanup errors for files that do not exist.
  }
}

async function main() {
  const db = await getDb();

  const app = createApp();
  const server = await new Promise((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const created = await createApiKey("load-test");
  const apiKey = created.apiKey;

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey
  };

  const scheduleAt = new Date(Date.now() + scheduleOffsetMinutes * 60_000).toISOString();

  let cursor = 0;
  let accepted = 0;
  let rejected = 0;
  const errors = [];

  const startedAt = performance.now();

  async function worker(workerId) {
    while (true) {
      const requestNumber = cursor;
      cursor += 1;

      if (requestNumber >= totalRequests) {
        return;
      }

      const payload = {
        type: "email",
        to: `load+${workerId}-${requestNumber}@exemplo.com`,
        subject: `Carga ${requestNumber}`,
        body: "Teste de carga de enfileiramento",
        schedule_at: scheduleAt
      };

      try {
        const response = await fetch(`${baseUrl}/notify`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload)
        });

        if (response.status === 202) {
          accepted += 1;
          continue;
        }

        rejected += 1;
        const body = await response.text();
        errors.push(`status=${response.status}; body=${body}`);
      } catch (error) {
        rejected += 1;
        errors.push(String(error.message || error));
      }
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i += 1) {
    workers.push(worker(i));
  }

  await Promise.all(workers);

  const finishedAt = performance.now();
  const elapsedMs = finishedAt - startedAt;
  const throughput = (totalRequests / elapsedMs) * 1000;

  const countRow = await db.get("SELECT COUNT(1) AS total FROM notifications");
  const dbTotal = Number(countRow?.total || 0);

  const summary = {
    total_requests: totalRequests,
    concurrency,
    accepted,
    rejected,
    db_total: dbTotal,
    elapsed_ms: Number(elapsedMs.toFixed(2)),
    throughput_req_per_sec: Number(throughput.toFixed(2))
  };

  console.log("[load-test] Summary:");
  console.log(JSON.stringify(summary, null, 2));

  if (errors.length > 0) {
    console.log("[load-test] Sample errors:");
    console.log(errors.slice(0, 5).join("\n"));
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  await closeDb();
  await removeIfExists(tempDbFile);
  await removeIfExists(`${tempDbFile}-wal`);
  await removeIfExists(`${tempDbFile}-shm`);

  const hasIntegrityMismatch = accepted !== totalRequests || rejected !== 0 || dbTotal !== totalRequests;
  if (hasIntegrityMismatch) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error("[load-test] Fatal error:", error);
  process.exitCode = 1;

  await closeDb().catch(() => {});
  await removeIfExists(tempDbFile);
  await removeIfExists(`${tempDbFile}-wal`);
  await removeIfExists(`${tempDbFile}-shm`);
});
