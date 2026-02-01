import { logger } from "./logger.js";

const SHUTDOWN_TIMEOUT_MS = 15_000;

export function installShutdownHandlers(handlers: (() => Promise<void> | void)[]): void {
  let shuttingDown = false;

  const run = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutdown initiated");

    const exitCode = signal === "uncaughtException" || signal === "unhandledRejection" ? 1 : 0;

    const forceTimer = setTimeout(() => {
      logger.error("Shutdown timed out, forcing exit");
      process.exit(exitCode || 1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();

    try {
      for (const h of handlers) {
        try {
          await h();
        } catch (err) {
          logger.error({ err }, "Shutdown handler failed");
        }
      }
    } finally {
      clearTimeout(forceTimer);
      logger.info("Shutdown complete");
      process.exit(exitCode);
    }
  };

  process.on("SIGINT", () => void run("SIGINT"));
  process.on("SIGTERM", () => void run("SIGTERM"));
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "Uncaught exception");
    void run("uncaughtException");
  });
  process.on("unhandledRejection", (err) => {
    logger.error({ err }, "Unhandled rejection");
    void run("unhandledRejection");
  });
}
