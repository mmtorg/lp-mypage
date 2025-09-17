// Minimal shims so TypeScript can resolve '@supabase/ssr' in IDEs
// Runtime code uses the actual package; this only satisfies type checking.
declare module '@supabase/ssr' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createBrowserClient<T = any, R = any>(
    supabaseUrl: string,
    supabaseKey: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options?: any
  ): any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createServerClient<T = any, R = any>(
    supabaseUrl: string,
    supabaseKey: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options?: any
  ): any;
}

