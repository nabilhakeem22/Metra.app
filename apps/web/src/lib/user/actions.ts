'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';

/** Per-user preference (Supabase user_metadata): dismiss the getting-started card. */
export async function dismissGettingStarted(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.updateUser({ data: { checklist_dismissed: true } });
}
