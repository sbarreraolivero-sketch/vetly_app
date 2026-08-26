// Envío puntual de correos de soporte/outreach a un cliente específico
// (ej. avisar de un bug de importación, pedir una confirmación). No es un
// flujo automatizado -- se invoca a mano, protegido con el service role key.
// Reusa el mismo remitente y estilo visual que send-welcome-email.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// El gateway de Supabase (verify_jwt: true, default) ya rechaza cualquier
// request sin un JWT firmado válido del proyecto antes de que este código
// corra. Acá solo se exige además que el rol del token sea service_role --
// decodificando el claim directo, en vez de comparar contra el env var
// SUPABASE_SERVICE_ROLE_KEY inyectado (no siempre coincide byte a byte con
// la clave real del proyecto).
const isServiceRole = (authHeader: string | null): boolean => {
    if (!authHeader?.startsWith("Bearer ")) return false;
    try {
        const payload = JSON.parse(atob(authHeader.slice(7).split(".")[1]));
        return payload.role === "service_role";
    } catch {
        return false;
    }
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

    if (!isServiceRole(req.headers.get("Authorization"))) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...CORS, "Content-Type": "application/json" },
        });
    }

    try {
        const { to, subject, html } = await req.json();
        if (!to || !subject || !html) {
            return new Response(JSON.stringify({ error: "Missing to/subject/html" }), {
                status: 400,
                headers: { ...CORS, "Content-Type": "application/json" },
            });
        }

        if (!RESEND_API_KEY) {
            return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
                status: 500,
                headers: { ...CORS, "Content-Type": "application/json" },
            });
        }

        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${RESEND_API_KEY}`,
            },
            body: JSON.stringify({
                from: "Vetly AI <hola@vetly.pro>",
                to,
                subject,
                html,
            }),
        });

        const data = await res.json();
        return new Response(JSON.stringify(data), {
            status: res.ok ? 200 : 502,
            headers: { ...CORS, "Content-Type": "application/json" },
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: String(error) }), {
            status: 500,
            headers: { ...CORS, "Content-Type": "application/json" },
        });
    }
});
