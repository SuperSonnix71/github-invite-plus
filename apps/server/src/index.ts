import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import rateLimit from "express-rate-limit";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { openDb } from "./db.js";
import { createSessionMiddleware } from "./session.js";
import { createAuthRouter } from "./auth.js";
import { createApiRouter } from "./api.js";
import { createWebhookRouter } from "./webhooks.js";
import { createInvitePoller } from "./poller.js";
import { createWorker } from "./worker.js";
import { installShutdownHandlers } from "./shutdown.js";
import { recoverStuckJobs } from "./jobs.js";

const app = express();
app.disable("x-powered-by");

app.set("trust proxy", 1);

app.use(pinoHttp({ logger }));
app.use(helmet());

app.use("/webhooks", express.json({
    limit: "5mb",
    verify: (req: Request, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
}));

app.use(express.json({ limit: "2mb" }));

const allowedOrigins = env.CORS_ORIGINS.split(",").map(s => s.trim()).filter(Boolean);
const allowAllOrigins = allowedOrigins.includes("*");

app.use(cors({
    origin: (origin, cb) => {
        if (allowAllOrigins) {
            cb(null, true);
            return;
        }
        if (!origin) {
            cb(null, true);
            return;
        }
        if (allowedOrigins.includes(origin)) {
            cb(null, true);
            return;
        }
        cb(new Error("CORS not allowed"));
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "x-csrf-token"],
    methods: ["GET", "POST", "OPTIONS"],
}));

const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: env.API_RPM,
    standardHeaders: true,
    legacyHeaders: false,
});

const db = openDb(env.DATABASE_PATH);
recoverStuckJobs(db);
app.use(createSessionMiddleware(db));

app.get("/", (_req, res) => {
    res.send("github-invite-plus server ok");
});
app.use("/auth", apiLimiter, createAuthRouter(db));
app.use("/api", apiLimiter, createApiRouter(db));
app.use("/webhooks", createWebhookRouter(db));

app.use((_err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: _err }, "Unhandled route error");
    if (!res.headersSent) {
        res.status(500).json({ ok: false, error: "Internal server error" });
    }
});

const poller = createInvitePoller(db);
const worker = createWorker(db);

const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, baseUrl: env.BASE_URL }, "Server listening");
    poller.start();
    worker.start();
});

installShutdownHandlers([
    () => poller.stop(),
    () => worker.stop(),
    () => new Promise<void>(resolve => { server.close(() => { resolve(); }); }),
    () => { db.close(); },
]);
