/**
 * hq-discover-prospects — descubrimiento de clínicas veterinarias para la
 * campaña de prospección del HQ. Se dispara a mano desde el panel
 * /hq/prospecting (país + ciudad + rubro), NUNCA por cron — el "scraper" no
 * es un crawler autónomo, es un lote bajo pedido (mismo criterio que el kit
 * de prospección de Nexflow, que tampoco corre solo).
 *
 * Vía primaria: Google Places API (Text Search + Place Details), si
 * GOOGLE_MAPS_API_KEY tiene esa API habilitada — más confiable y
 * estructurado que WebSearch/WebFetch manual. Si Places no está disponible
 * (status !== "OK" en el primer intento), la función devuelve
 * `places_available:false` y el descubrimiento cae al método manual dirigido
 * por Claude (mismo que usó la campaña de mayo 2026 — 15 clínicas chilenas).
 *
 * Filtros ANTES de insertar:
 *  - excluye "hospital veterinario"/"hospital vet" en el nombre (heurística
 *    de partida — la revisión humana en el panel es la red de seguridad
 *    real antes de generar/enviar ningún correo)
 *  - exige email o al menos web (el canal es 100% correo — sin ninguno de
 *    los dos, el lead no sirve para esta campaña)
 *  - dedup contra prospecting_leads (google_place_id) y contra los 15
 *    crm_prospects de la campaña de mayo (teléfono normalizado) — nadie
 *    recibe outreach dos veces por dos campañas distintas
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") || "";
const HQ_ID = "00000000-0000-0000-0000-000000000000";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HOSPITAL_NAME_PATTERN = /hospital\s*vet/i;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function normalizePhone(phone: string | null | undefined): string {
  return (phone || "").replace(/\D/g, "");
}

// Score de "oportunidad Vetly" — a diferencia del molde de Nexflow (que
// premia AUSENCIA de presencia digital porque vende posicionamiento), acá
// premiamos señales de clínica YA ESTABLECIDA con volumen real de clientes
// — ver "Corrección de scoring" en el plan de esta feature. La revisión
// humana en el panel es lo que decide de verdad; esto solo prioriza la cola.
function scoreFromPlacesSignals(rating: number | undefined, reviewCount: number | undefined, hasWebsite: boolean, hasPhone: boolean): number {
  let score = 30; // base neutra
  if ((reviewCount ?? 0) >= 15) score += 25;
  if ((reviewCount ?? 0) >= 50) score += 15;
  if ((reviewCount ?? 0) < 5) score -= 25; // muy nueva / sin trayectoria verificable
  if ((rating ?? 0) >= 4.3) score += 10;
  if (hasWebsite) score += 10;
  if (hasPhone) score += 10;
  return Math.max(0, Math.min(100, score));
}

function inferProspectType(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("domicilio") || n.includes("móvil") || n.includes("movil")) {
    return n.includes("equipo") || n.includes("clínica") || n.includes("clinica") ? "Móvil Equipo" : "Móvil Individual";
  }
  return "Física Pequeña"; // default seguro, editable en revisión
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) return json({ error: "No autorizado" }, 401);

    const { data: admin } = await supabase.from("platform_admins").select("id").eq("id", user.id).maybeSingle();
    if (!admin) return json({ error: "Solo administradores de plataforma" }, 403);

    const { country, city, niche = "veterinaria", limit = 15 } = await req.json();
    if (!country || !city) return json({ error: "Faltan country y city" }, 400);

    if (!GOOGLE_MAPS_API_KEY) {
      return json({ places_available: false, reason: "GOOGLE_MAPS_API_KEY no configurada", inserted: 0 });
    }

    const query = encodeURIComponent(`${niche} en ${city}, ${country}`);
    const searchRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${GOOGLE_MAPS_API_KEY}`,
    );
    const searchData = await searchRes.json();

    if (searchData.status !== "OK" && searchData.status !== "ZERO_RESULTS") {
      // REQUEST_DENIED (Places no habilitada), OVER_QUERY_LIMIT, etc. — se
      // avisa explícito para que el llamador caiga al método manual.
      return json({
        places_available: false,
        reason: `Places API status: ${searchData.status}`,
        error_message: searchData.error_message,
        inserted: 0,
      });
    }

    const results = (searchData.results || []).slice(0, limit);
    let inserted = 0;
    let skippedExisting = 0;
    let skippedHospital = 0;
    let skippedNoContact = 0;
    let skippedLowScore = 0;
    const errors: string[] = [];

    // Dedup contra la campaña manual de mayo 2026 (crm_prospects, HQ_ID) —
    // por teléfono normalizado, para no volver a contactar a las mismas 15.
    const { data: existingCrm } = await supabase
      .from("crm_prospects")
      .select("phone")
      .eq("clinic_id", HQ_ID);
    const existingPhones = new Set((existingCrm || []).map((r: any) => normalizePhone(r.phone)).filter(Boolean));

    for (const place of results) {
      try {
        if (HOSPITAL_NAME_PATTERN.test(place.name || "")) { skippedHospital++; continue; }

        // Place Details — trae teléfono y web, que Text Search no siempre incluye.
        const detailsRes = await fetch(
          `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}` +
          `&fields=formatted_phone_number,international_phone_number,website,name,formatted_address,rating,user_ratings_total` +
          `&key=${GOOGLE_MAPS_API_KEY}`,
        );
        const details = (await detailsRes.json())?.result || {};

        const website: string | null = details.website || null;
        const phoneRaw: string | null = details.international_phone_number || details.formatted_phone_number || null;
        const phoneNorm = normalizePhone(phoneRaw);

        if (!website) { skippedNoContact++; continue; } // sin web no hay de dónde sacar email — canal es 100% correo
        if (phoneNorm && existingPhones.has(phoneNorm)) { skippedExisting++; continue; }

        // Intento liviano de extraer email de la portada (mismo criterio que
        // el kit de prospección: portada primero, /contacto como fallback).
        let email: string | null = null;
        let hasHttps = false;
        try {
          const siteRes = await fetch(website, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mozilla/5.0 (compatible; VetlyProspectBot/1.0)" } });
          hasHttps = website.startsWith("https://");
          const html = await siteRes.text();
          const emailMatch = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
          const generic = ["info@", "contacto@", "admin@", "support@", "noreply@", "hola@", "ventas@"];
          email = (emailMatch || []).find(e => !generic.some(g => e.toLowerCase().startsWith(g))) || emailMatch?.[0] || null;
        } catch {
          // sitio no responde — igual se inserta (queda para revisión manual, puede tener email en otro lado)
        }

        if (!email) { skippedNoContact++; continue; }

        const score = scoreFromPlacesSignals(details.rating, details.user_ratings_total, true, !!phoneNorm);

        // Filtro de calidad — mismo criterio que el kit de prospección de
        // Nexflow (ahí corta en >50, con semántica invertida). Acá <40 sale
        // casi siempre del castigo por <5 reseñas: negocio muy nuevo, sin
        // trayectoria verificable — justo el perfil que NO es el ICP real
        // de Vetly (clínica ya establecida con clientela). Mismo umbral que
        // separa gris de ámbar en el badge de score del panel.
        if (score < 40) { skippedLowScore++; continue; }

        const { error: insertError } = await supabase.from("prospecting_leads").insert({
          name: details.name || place.name,
          website,
          email,
          phone: phoneRaw,
          address: details.formatted_address || place.formatted_address || null,
          country,
          city,
          prospect_type: inferProspectType(details.name || place.name || ""),
          score,
          has_https: hasHttps,
          google_place_id: place.place_id,
          contact_status: "sin_contactar",
        });

        if (insertError) {
          if (insertError.code === "23505") { skippedExisting++; } // ya insertado antes (unique place_id)
          else { errors.push(`${place.name}: ${insertError.message}`); }
        } else {
          inserted++;
        }
      } catch (e) {
        errors.push(`${place.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return json({
      places_available: true,
      found: results.length,
      inserted,
      skipped_existing: skippedExisting,
      skipped_hospital: skippedHospital,
      skipped_no_contact: skippedNoContact,
      skipped_low_score: skippedLowScore,
      errors,
    });
  } catch (e) {
    console.error("[hq-discover-prospects] error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
