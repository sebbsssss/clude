import { Router, Request, Response } from 'express';
import express from 'express';
import path from 'path';
export function staticRoutes(): Router {
  const router = Router();

  // __dirname is apps/backend/src/routes (dev) or apps/backend/dist/routes (prod)
  const monorepoRoot = path.join(__dirname, '..', '..', '..', '..');
  const webPublicDir = path.join(monorepoRoot, 'apps', 'web', 'public');

  // Landing page
  const landingPage = path.join(webPublicDir, 'index.html');
  router.get('/', (_req: Request, res: Response) => {
    res.sendFile(landingPage);
  });

  // ── Pretty URL aliases for static HTML pages ─────────────────────

  router.get('/venice', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/privacy.html';
    next();
  });
  router.get('/privacy', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/privacy.html';
    next();
  });

  router.get('/benchmark', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/benchmark.html';
    next();
  });

  router.get('/trace', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/trace.html';
    next();
  });

  router.get('/register', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/register.html';
    next();
  });

  router.get('/install', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/install.html';
    next();
  });

  router.get('/compare', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/compare.html';
    next();
  });

  router.get('/agents', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/install.html';
    next();
  });

  router.get('/portability', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/portability.html';
    next();
  });

  router.get('/journal', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/journal.html';
    next();
  });

  router.get('/docs', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/docs.html';
    next();
  });

  router.get('/explore', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/explore.html';
    next();
  });

  // ── React SPAs ────────────────────────────────────────────────────

  // Dashboard SPA at /dashboard
  const dashboardDir = path.join(monorepoRoot, 'apps', 'dashboard', 'dist');
  router.use('/dashboard', express.static(dashboardDir, { maxAge: '1h', setHeaders: (res, filePath) => { if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); } }));
  router.get('/dashboard/*', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(dashboardDir, 'index.html'));
  });
  router.get('/dashboard', (_req: Request, res: Response) => {
    res.redirect('/dashboard/');
  });

  // LOTR guest page — serve dashboard SPA at /lotr (campaign, temporary)
  router.get('/lotr', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(dashboardDir, 'index.html'));
  });

  // Chat SPA at /chat
  const chatDir = path.join(monorepoRoot, 'apps', 'chat', 'dist');
  const serveChatIndex = (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.sendFile(path.join(chatDir, 'index.html'));
  };
  router.get('/chat/', serveChatIndex);
  router.get('/chat', (_req: Request, res: Response) => { res.redirect('/chat/'); });
  router.use('/chat', express.static(chatDir, { maxAge: '7d' }));
  router.get('/chat/*', serveChatIndex);

  // ── Redirects ─────────────────────────────────────────────────────

  router.get('/setup', (_req: Request, res: Response) => {
    res.redirect('/dashboard/setup');
  });

  router.get('/dashboard-new*', (_req: Request, res: Response) => {
    res.redirect('/dashboard/');
  });

  // Sample memory packs
  const samplesDir = path.join(webPublicDir, 'samples');
  router.use('/samples', express.static(samplesDir));

  // Serve static files from apps/web/public/
  router.use(express.static(webPublicDir));

  return router;
}
