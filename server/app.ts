import express, { type Request, type Response } from 'express';
import semanticMatches from '../api/overlap/matches';

export function createLocalApiApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2kb' }));
  app.use((_req: Request, res: Response, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  // Reuse the same method handling and authenticated matcher for local development.
  app.all('/api/overlap/matches', (req, res) => {
    void semanticMatches(req, res);
  });

  return app;
}
