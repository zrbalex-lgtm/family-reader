import { createClient } from '@supabase/supabase-js';
import { inspectConfig } from './config.js';
import { progressFetch } from './upload-transport.js';

export const configurationError = inspectConfig(import.meta.env);
// Where supabase-js keeps the session in localStorage (also read by the offline fallback in auth.js).
export const authStorageKey = configurationError ? '' : `family-reader:${new URL(import.meta.env.VITE_SUPABASE_URL).host}:${import.meta.env.BASE_URL}:auth`;
export const supabase = configurationError ? null : createClient(
  import.meta.env.VITE_SUPABASE_URL.trim(),
  import.meta.env.VITE_SUPABASE_ANON_KEY.trim(),
  {
    global: { fetch: progressFetch },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: authStorageKey,
    },
  },
);
