const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

console.log('URL:', process.env.VITE_SUPABASE_URL);
console.log('KEY length:', process.env.SUPABASE_SERVICE_ROLE_KEY?.length);

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const { data, error } = await sb.from('debug_logs').select('count');
  if (error) console.error('SB Error:', error);
  else console.log('Count:', data);
}
test();
