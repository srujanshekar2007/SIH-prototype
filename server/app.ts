import express, { type Request, type Response } from 'express';

type CaseSummaryInput = {
  case_number: string;
  subject: string | null;
  description: string | null;
  category: string | null;
  status: string;
  priority: string | null;
  received_at: string;
  next_action_at: string | null;
  institutions: { name: string; internal_id: string } | null;
  bureaus: { name: string } | null;
};

type Dependencies = {
  authClient: any;
  createUserClient: (accessToken: string) => any;
  health: () => Promise<boolean>;
  summarize: (input: { complaint: CaseSummaryInput; actions: any[] }) => Promise<string>;
};

function isLocalOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function hasAuthorizedRole(profile: any) {
  return profile?.is_admin === true || ['aicte_official', 'pgrc_officer', 'rb_officer'].includes(profile?.role);
}

export function createLocalAiApp(deps: Dependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2kb' }));
  app.use((_req: Request, res: Response, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.get('/api/ai/health', async (_req, res) => {
    try {
      const available = await deps.health();
      return res.status(available ? 200 : 503).json({ available, engine: 'Ollama' });
    } catch {
      return res.status(503).json({ available: false, engine: 'Ollama' });
    }
  });

  app.post('/api/ai/cases/:caseId/summary', async (req, res) => {
    const origin = req.get('origin');
    if (origin && !isLocalOrigin(origin)) return res.status(403).json({ error: 'Local app origin required.' });

    const authorization = req.get('authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (!match) return res.status(401).json({ error: 'Sign in to request a case summary.' });

    const caseId = String(req.params.caseId || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(caseId)) {
      return res.status(400).json({ error: 'A valid case ID is required.' });
    }

    try {
      const { data: authData, error: authError } = await deps.authClient.auth.getUser(match[1]);
      if (authError || !authData?.user) return res.status(401).json({ error: 'Your session is invalid or expired.' });

      const userDb = deps.createUserClient(match[1]);
      const { data: profile, error: profileError } = await userDb.from('profiles')
        .select('id,role,is_admin,active')
        .eq('id', authData.user.id)
        .maybeSingle();
      if (profileError) return res.status(503).json({ error: 'Could not verify your authorized profile.' });
      if (!profile || profile.active !== true || !hasAuthorizedRole(profile)) {
        return res.status(403).json({ error: 'An active authorized profile is required.' });
      }

      // This client carries the caller's JWT and anon key, so Supabase RLS—not the browser—
      // decides whether this account can read the requested complaint and its history.
      const { data: complaint, error: caseError } = await userDb.from('complaints')
        .select('case_number,subject,description,category,status,priority,received_at,next_action_at,institutions(name,internal_id),bureaus(name)')
        .eq('id', caseId)
        .maybeSingle();
      if (caseError) return res.status(503).json({ error: 'Could not load an authorized case record.' });
      if (!complaint) return res.status(404).json({ error: 'Case not found or not available to your role.' });

      const { data: actions, error: actionsError } = await userDb.from('case_actions')
        .select('action_type,remarks,status_before,status_after,created_at')
        .eq('complaint_id', caseId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (actionsError) return res.status(503).json({ error: 'Could not load authorized case history.' });

      const summary = await deps.summarize({
        complaint: {
          ...complaint,
          subject: clip(complaint.subject, 1000),
          description: clip(complaint.description, 8000),
        },
        actions: (actions || []).map((action: any) => ({
          ...action,
          remarks: clip(action.remarks, 1000),
        })),
      });
      if (!summary.trim()) return res.status(502).json({ error: 'Ollama returned an empty summary.' });
      return res.json({ summary: summary.slice(0, 12000), stored: false, engine: 'Ollama' });
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError'
        ? 'Ollama took too long to respond. Try again.'
        : 'Local AI is unavailable. Check that Ollama is running with the configured model.';
      return res.status(503).json({ error: message });
    }
  });

  return app;
}

function clip(value: string | null | undefined, maxLength: number) {
  return value ? value.slice(0, maxLength) : null;
}
