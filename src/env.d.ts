// Only VITE_-prefixed variables reach the browser bundle. Both are public by
// design: the anon key can read nothing but the current_state view.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}
