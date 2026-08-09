// Browser-safe Supabase URL + anon key. Never reference the service-role key here.
export function supabaseUrl(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!v) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  return v;
}

export function supabaseAnonKey(): string {
  const v =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!v)
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY (or _PUBLISHABLE_KEY) is not set',
    );
  return v;
}
