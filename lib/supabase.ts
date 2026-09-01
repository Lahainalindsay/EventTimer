import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const deploymentTarget = process.env.NEXT_PUBLIC_EVENT_TIMER_ENV ?? (process.env.NODE_ENV === "test" ? "test" : "production");
const expectedRefs: Record<string, string | undefined> = {
  production: process.env.NEXT_PUBLIC_SUPABASE_PRODUCTION_REF,
  staging: process.env.NEXT_PUBLIC_SUPABASE_STAGING_REF,
  test: process.env.NEXT_PUBLIC_SUPABASE_TEST_REF,
};

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    "Event Timer cloud configuration is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
  );
}

function projectRefFromUrl(url: string): string | null {
  try {
    const host = new URL(url).host;
    const suffix = ".supabase.co";
    return host.endsWith(suffix) ? host.slice(0, -suffix.length) : null;
  } catch {
    return null;
  }
}

const actualRef = projectRefFromUrl(supabaseUrl);
const expectedRef = expectedRefs[deploymentTarget];

if (!expectedRef) {
  throw new Error(`Event Timer Supabase project ref is not configured for ${deploymentTarget}.`);
}

if (actualRef !== expectedRef) {
  throw new Error("Event Timer is configured for an unexpected Supabase project.");
}

if (process.env.NODE_ENV === "test" && actualRef === expectedRefs.production) {
  throw new Error("Automated tests must not use the production Supabase project.");
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const EVENT_TIMER_SUPABASE_REF = expectedRef;
