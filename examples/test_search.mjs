import 'dotenv/config';
import { loadConfig } from './dist/config/loader.js';
import { supabaseManager, initSupabase } from './dist/storage/supabase.js';

// Load the config
const config = loadConfig('./flashquery.yml');

console.log('Config loaded');
console.log('  instance.id:', config.instance.id);
console.log('  vault.path:', config.instance.vault.path);

// Initialize supabase
await initSupabase(config);
const supabase = supabaseManager.getClient();

// Query like search_documents does
const { data, error } = await supabase
  .from('fqc_documents')
  .select('id, path, title, status, created_at')
  .eq('instance_id', config.instance.id)
  .neq('status', 'archived');

if (error) {
  console.error('Query error:', error);
} else {
  console.log(`\nFound ${data?.length ?? 0} documents:`);
  data?.forEach(doc => {
    console.log(`  - ${doc.title} (path=${doc.path}, status=${doc.status})`);
  });
}
