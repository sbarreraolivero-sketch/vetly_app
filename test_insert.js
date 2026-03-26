const { createClient } = require('@supabase/supabase-js');
const sb = createClient("https://hubjqllcmbzoojyidgcu.supabase.co", process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const { data, error } = await sb.from("appointments").insert({
        clinic_id: "8c7b8084-259e-4a6c-94cc-1360db45d6dd", // Need a real clinic ID
        patient_name: "Carla constant",
        phone_number: "+56912345678",
        service: "Microblading de cejas",
        appointment_date: "2026-03-23T18:00:00-03:00",
        status: "pending",
        duration: 90,
        price: 99000
    }).select().single();
  console.log("Error:", error);
  console.log("Data:", data);
}
test();
