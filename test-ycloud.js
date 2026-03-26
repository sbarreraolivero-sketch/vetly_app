require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function test() {
  const { data, error } = await supabase.functions.invoke('create-ycloud-template', {
    body: {
      clinic_id: 'dummy',
      name: 'test',
      body_text: 'hello'
    }
  });

  console.log('Data:', data);
  console.log('Error:', error);
}

test();
