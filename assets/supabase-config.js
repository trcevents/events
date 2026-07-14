// Shared Supabase connection details for the comp-ticket intake + admin pages.
// The anon key is safe to expose client-side — it only grants what Row Level
// Security policies in supabase/migrations/0001_comp_requests.sql allow.
window.TRC_SUPABASE_CONFIG = {
  url: "https://xdjbgcqaynnzykrglgnf.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkamJnY3FheW5uenlrcmdsZ25mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MjEwMDcsImV4cCI6MjA5ODk5NzAwN30.KW-v5bU1LlSkwWlZ3oapXwuxvspzv9GpBifi8_GyHZI",
};
