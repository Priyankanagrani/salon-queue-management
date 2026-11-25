import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_URL) || 'https://placeholder-project.supabase.co'
const supabaseAnonKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) || (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_ANON_KEY) || 'placeholder-anon-key'

// Check if actual credentials have been configured
export const isSupabaseConfigured = () => {
  return (
    supabaseUrl &&
    supabaseUrl !== 'https://placeholder-project.supabase.co' &&
    supabaseAnonKey &&
    supabaseAnonKey !== 'placeholder-anon-key'
  )
}

// Single initialized Supabase client using anonymous public key only.
// The service_role key must NEVER be exposed or used here.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false // Customer and kiosk sessions are managed via scoped RPC tokens
  },
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  }
})
