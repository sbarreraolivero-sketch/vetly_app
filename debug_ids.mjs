import { createClient } from "@supabase/supabase-js";
const SB_URL = "https://uiivlpowrsseylfrtjht.supabase.co";
const SB_SERVICE_ROLE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpaXZscG93cnNzZXlsZnJ0amh0Iiwicm9sZSI6InVzZXJfcm9sZSIsImlhdCI6MTc3Mzc5MjU5NywiZXhwIjoyMDg5MzY4NTk3fQ.rjqXyPXSWCAePVK9hKzEkavSSqe4-3bc9NcCBhPaoeM";
const supabase = createClient(SB_URL, SB_SERVICE_ROLE);
async function check() {
  const { data, error } = await supabase.from("clinic_settings").select("id, clinic_name");
  if (error) console.error("Error from Supabase:", error);
  else console.log("Clinics Ids:", data);
}
check();
