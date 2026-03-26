import { createClient } from "@supabase/supabase-js";

const SB_URL = "https://uiivlpowrsseylfrtjht.supabase.co";
const SB_SERVICE_ROLE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpaXZscG93cnNzZXlsZnJ0amh0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzc5MjU5NywiZXhwIjoyMDg5MzY4NTk3fQ.rjqXyPXSWCAePVK9hKzEkavSSqe4-3bc9NcCBhPaoeM";

const supabase = createClient(SB_URL, SB_SERVICE_ROLE);

async function check() {
  const { data: users, error: userError } = await supabase.auth.admin.listUsers();
  if (userError) console.error("Error listing users:", userError);
  else console.log("Users count:", users.users.length);

  const { count, error: clinicError } = await supabase.from("clinic_settings").select("*", { count: "exact", head: true });
  if (clinicError) console.error("Error checking clinics:", clinicError);
  else console.log("Clinics count:", count);
}

check();
