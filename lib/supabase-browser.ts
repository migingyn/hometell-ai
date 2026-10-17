// Browser client. Anon key only, read access plus Realtime.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browser: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (browser) return browser;
  browser = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return browser;
}
