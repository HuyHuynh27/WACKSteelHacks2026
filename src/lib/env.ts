/**
 * Small helpers so a missing env var fails loudly at the call site instead of
 * silently producing `undefined` deep inside the Supabase client.
 */

/**
 * Server-only. Reads `process.env` by a computed key, which Next cannot
 * statically analyse, so this must never be used for a NEXT_PUBLIC_* value in
 * code that reaches the browser — the bundler would leave it undefined.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

/**
 * For NEXT_PUBLIC_* values. The caller passes the literal `process.env.FOO`
 * access so the bundler can inline it; the name is only used for the message.
 */
function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export const PUBLIC_SUPABASE_URL = required(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  "NEXT_PUBLIC_SUPABASE_URL",
);

export const PUBLIC_SUPABASE_ANON_KEY = required(
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
);

// Push is optional: the app should still run for anyone who hasn't set up a
// VAPID keypair, so this one stays soft. Callers check for the empty string.
export const PUBLIC_VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";