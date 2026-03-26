const fs = require("fs");
const keyMatch = fs.readFileSync(".env", "utf8").match(/OPENAI_API_KEY=([^\n]+)/);
const key = keyMatch[1].trim();

const sysPrompt = `Eres un asistente amable y profesional para una clínica estética.
9. FLUJO DE RESERVA Y COBRO (ORDEN OBLIGATORIO):
   a) Ofrecer Slots: Llama a 'check_availability', muestra las opciones y menciona el abono de $10.000.
   b) Selección y Nombre: Cuando el paciente elija un horario, pídele su NOMBRE COMPLETO. Si ya tienes el nombre pero no la hora, pídele elegir una de las ofrecidas.
   c) Registro: SOLO cuando tengas EL NOMBRE Y EL HORARIO confirmado, LLAMA a 'create_appointment'. Debes enviar 'patient_name', 'date', 'time' y 'service_name' SIEMPRE. Si falta uno (ej. la hora), NO llames a la herramienta todavía.
   d) Datos de Pago: SI 'create_appointment' devuelve 'success: true', envía los datos de transferencia.
   e) Validación: Si envía comprobante, agradece y confirma que está pendiente de validación manual.
10. VERIFICACIÓN DE IDENTIDAD Y ERRORES: Si 'create_appointment' falla con 'Error DB-CONFLICT', menciona este código literalmente y pide al usuario que agregue su segundo apellido o use su nombre completo real para evitar duplicados en el sistema.
7. Si intentas llamar a 'create_appointment' y falla, DEBES decirle al usuario el CÓDIGO EXACTO DEL ERROR (ej: Error DB-AG-01 o Error DB-CONFLICT) que te devuelva la herramienta. NO ocultes el código del error. Pídele corregirlo y NO saltes al cobro.
`;

const tools = [
    {
        name: "create_appointment",
        description: "Crea nueva cita. Pasa fecha YYYY-MM-DD y hora de 24 horas.",
        parameters: { type: "object", properties: { patient_name: { type: "string" }, date: { type: "string" }, time: { type: "string" }, service_name: { type: "string" } }, required: ["patient_name", "date", "time", "service_name"] }
    }
];

async function run() {
  const msgs = [
    { role: "system", content: sysPrompt },
    { role: "assistant", content: "Para el 23 de marzo, tenemos los siguientes horarios disponibles para Microblading de cejas: 10:00 AM, 12:00 PM. ¿Cuál te acomoda? Una vez que elijas, necesitaré tu nombre completo para agendar." },
    { role: "user", content: "a las 10" },
    { role: "assistant", content: "¡Genial! Por favor, indícame tu nombre completo para agendar tu cita para el 23 de marzo a las 10:00 AM." },
    { role: "user", content: "Maritza Peña Prueba" }
  ];

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: msgs, functions: tools, function_call: "auto" })
  });
  console.log("Response 1:", JSON.stringify(await r.json(), null, 2));
}
run();
