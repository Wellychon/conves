import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

// só em desenvolvimento: facilita inspecionar no console
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __sb: typeof supabase }).__sb = supabase;
}
