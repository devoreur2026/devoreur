// Load .env into process.env before anything reads it. Imported first by
// index.js so auth.js sees SUPABASE_* at module-eval time. On hosts like Render
// there's no .env file (vars are set directly), so a missing file is fine.
try { process.loadEnvFile(); } catch (e) { /* no .env file — that's ok */ }
