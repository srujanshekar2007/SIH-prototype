import { loadEnv } from 'vite';
import { createLocalApiApp } from './app';

const env = loadEnv(process.env.NODE_ENV === 'production' ? 'production' : 'development', process.cwd(), '');
for (const key of [
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY', 'OPENAI_EMBEDDING_MODEL', 'AI_SIMILARITY_THRESHOLD',
  'AI_EXTERNAL_COMPLAINT_TEXT_APPROVED',
]) {
  if (!process.env[key] && env[key]) process.env[key] = env[key];
}
if (!process.env.SUPABASE_URL && env.VITE_SUPABASE_URL) process.env.SUPABASE_URL = env.VITE_SUPABASE_URL;
if (!process.env.SUPABASE_ANON_KEY && env.VITE_SUPABASE_ANON_KEY) process.env.SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;

const supabaseUrl = env.VITE_SUPABASE_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY;
if (!supabaseUrl || !anonKey || isServiceRoleKey(anonKey)) {
  throw new Error('Set VITE_SUPABASE_URL and the publishable VITE_SUPABASE_ANON_KEY in .env.local. Do not use a service-role key.');
}

const port = Number(env.LOCAL_API_PORT || 3001);
createLocalApiApp().listen(port, '127.0.0.1', () => {
  console.log(`Local API listening on http://127.0.0.1:${port}`);
});

function isServiceRoleKey(value: string) {
  const segments = value.split('.');
  if (segments.length !== 3) return false;
  try {
    const claims = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
    return claims.role === 'service_role';
  } catch {
    return false;
  }
}
