import { pino } from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "token",
      "refresh_token",
      "access_token",
      "privateKey",
      "session"
    ],
    censor: "[REDACTED]"
  }
});
