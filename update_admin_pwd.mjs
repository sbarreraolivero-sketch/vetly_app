import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
    'ff79adfa-b47e-4e15-8483-fdac9c108ea7', // sbarrera.olivero@gmail.com
    { password: 'AdminPassword2026!' }
  );
  if (error) console.error(error);
  else console.log('Password updated successfully!');
}
run();
