import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.user) {
    res.status(401).json({ ok: false, error: "Not authenticated" });
    return;
  }
  next();
}

export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  const user = req.session.user;
  if (!user) {
    res.status(401).json({ ok: false, error: "Not authenticated" });
    return;
  }
  const token = req.header("x-csrf-token") ?? "";
  if (token.length === 0 || token.length !== user.csrfToken.length ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(user.csrfToken))) {
    res.status(403).json({ ok: false, error: "CSRF validation failed" });
    return;
  }
  next();
}
