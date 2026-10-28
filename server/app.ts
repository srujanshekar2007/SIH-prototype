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

  app.use((error: any, req: Request, res: Response, next: (error?: unknown) => void) => {
    if (req.path !== '/api/overlap/matches') {
      return next(error);
    }
    if (error?.type === 'entity.too.large') {
      return res.status(413).json({ code: 'request_too_large', message: 'The request body exceeds the allowed size.' });
    }
    return res.status(400).json({ code: 'invalid_json', message: 'Send a valid JSON request body.' });
  });

  return app;
}
