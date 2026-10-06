import { createClient } from '@supabase/supabase-js';
import { inspectConfig } from './config.js';

export const configurationError = inspectConfig(import.meta.env);
export const supabase = configurationError ? null : createClient(
  import.meta.env.VITE_SUPABASE_URL.trim(),
  import.meta.env.VITE_SUPABASE_ANON_KEY.trim(),
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: `family-reader:${new URL(import.meta.env.VITE_SUPABASE_URL).host}:${import.meta.env.BASE_URL}:auth`,
    },
  },
);
