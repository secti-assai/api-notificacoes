const cron = require("node-cron");
const config = require("../config");
const { processDueNotifications } = require("../services/notificationService");

function startNotificationWorker() {
  let isRunning = false;

  const run = async () => {
    if (isRunning) {
      console.warn("[worker] Previous execution still running, skipping this tick.");
      return;
    }

    isRunning = true;
    try {
      const summary = await processDueNotifications();
      if (summary.processed > 0) {
        console.log("[worker] Summary:", summary);
      }
    } catch (error) {
      console.error("[worker] Execution failed:", error);
    } finally {
      isRunning = false;
    }
  };

  const task = cron.schedule(config.worker.cronExpression, () => {
    void run();
  });

  console.log(`[worker] Started with cron '${config.worker.cronExpression}'`);

  void run();

  return {
    stop: () => {
      task.stop();
      if (typeof task.destroy === "function") {
        task.destroy();
      }
    },
    runNow: run
  };
}

module.exports = {
  startNotificationWorker
};
