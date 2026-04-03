import express, { Request, Response } from 'express';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many API requests' },
});

export function corsMiddleware(req: Request, res: Response, next: express.NextFunction) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-BYOK-Key, X-BYOK-Provider');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
}

export function securityHeaders(_req: Request, res: Response, next: express.NextFunction) {
  res.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'SAMEORIGIN');
  res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

export function apiCacheControl(_req: Request, res: Response, next: express.NextFunction) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
}

export function createCompression(): express.RequestHandler {
  return compression({
    filter: (req, res) => {
      if (res.getHeader('Content-Type') === 'text/event-stream') return false;
      return compression.filter(req, res);
    },
  });
}
