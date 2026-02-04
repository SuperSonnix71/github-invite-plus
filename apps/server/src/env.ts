import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
    NODE_ENV: z.string().optional().default("development"),
    PORT: z.coerce.number().int().positive().default(8787),

    BASE_URL: z.string().url(),

    GITHUB_APP_CLIENT_ID: z.string().min(10),
    GITHUB_APP_CLIENT_SECRET: z.string().min(10),

    TOKEN_ENC_KEY_BASE64: z.string().min(40),

    SESSION_SECRET: z.string().min(32),

    CORS_ORIGINS: z.string(),

    WEBHOOK_SECRET: z.string().min(20).optional(),

    MEILI_URL: z.string().url().default("http://localhost:7700"),
    MEILI_MASTER_KEY: z.string().min(8),

    INVITE_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(30).default(180),

    MAX_BLOB_BYTES: z.coerce.number().int().min(1024).default(512_000),
    MAX_INDEX_FILES_PER_BRANCH: z.coerce.number().int().min(1).default(20_000),
    INDEX_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(6),

    API_RPM: z.coerce.number().int().min(10).default(240),

    EXTENSION_REDIRECT_URI: z.string().url(),

    COOKIE_DOMAIN: z.string().optional(),
    DATABASE_PATH: z.string().default("gip.sqlite"),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = (() => {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
        const msg = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
        process.stderr.write(`Invalid environment configuration: ${msg}\n`);
        process.exit(1);
    }
    return parsed.data;
})();

export const isProd = env.NODE_ENV === "production";

export function cookieSecure(): boolean {
    return isProd || env.BASE_URL.startsWith("https://");
}

export function cookieSameSite(): "none" | "lax" {
    return cookieSecure() ? "none" : "lax";
}
