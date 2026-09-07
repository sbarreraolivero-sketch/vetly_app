/**
 * ════════════════════════════════════════════════════════════════════════════
 * MATRIZ DE PRECIOS — cálculo determinístico de precios que dependen de
 * variables (especie, sexo, peso, tramo, tipo de anestesia)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Reemplaza el enfoque anterior — el agente de IA leyendo una tabla de precios
 * en texto y "cruzando" especie×sexo×peso×tramo mentalmente — que causó
 * cotizaciones incorrectas reales y repetidas (una perra de 30kg cotizada en
 * $85.000 cuando el precio real era $115.000, con la tabla completa en el
 * contexto del modelo). El precio ahora vive en tablas relacionales
 * (`clinic_price_matrices` / `clinic_price_matrix_cells` /
 * `clinic_price_matrix_modifiers`), configurables desde Ajustes → Servicios y
 * Precios sin tocar código, y el agente solo tiene que llamar a
 * `lookupMatrixPrice` y comunicar el resultado — nunca calcularlo él mismo.
 *
 * Diseñado contra los 4 casos reales que existen hoy en producción (cirugía y
 * destartraje de Linares y Santiago) — ver el plan de la sesión que introdujo
 * este archivo para el detalle completo de cada uno.
 */

export interface MatrixLookupArgs {
    species?: string;
    sex?: string;
    procedure_type?: string;
    anesthesia_type?: string;
    weight_kg?: number;
    travel_minutes?: number;
    in_heat_or_pregnant?: boolean;
}

export interface MatrixLookupResult {
    success: boolean;
    price_total?: number;
    tramo?: string;
    breakdown?: string;
    requires_human?: boolean;
    missing_fields?: string[];
    message: string;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;

/**
 * Busca el precio de una matriz configurada para la clínica. Nunca inventa un
 * valor: ante cualquier ambigüedad (matriz inexistente, datos faltantes,
 * ninguna celda coincidente, o más de una) devuelve `success:false` con una
 * instrucción clara de qué hacer — pedir el dato que falta, o escalar a un
 * humano. Un caso con `requires_human:true` es una celda real marcada a
 * propósito como "sin precio automático" (ej. las 2 combinaciones de cirugía
 * inhalatoria de Santiago que la propia clínica no tiene definidas).
 */
export async function lookupMatrixPrice(
    sb: any,
    clinicId: string,
    matrixKey: string,
    args: MatrixLookupArgs,
): Promise<MatrixLookupResult> {
    if (!matrixKey) {
        return { success: false, message: "Falta matrix_key — usa exactamente uno de los listados en el bloque MATRICES DE PRECIO de tu contexto." };
    }

    const { data: matrix } = await sb
        .from("clinic_price_matrices")
        .select("id, dimensions_used, tramo_ranges")
        .eq("clinic_id", clinicId)
        .eq("matrix_key", matrixKey)
        .eq("status", "active")
        .maybeSingle();

    if (!matrix) {
        return { success: false, message: `Esta clínica no tiene configurada la matriz "${matrixKey}". No inventes un precio — usa get_knowledge o escala a un humano.` };
    }

    const dims = matrix.dimensions_used || {};
    const missing: string[] = [];

    // Solo species/weight_kg/travel_minutes se piden por adelantado — son
    // genuinamente indispensables en los 4 casos reales conocidos. sex,
    // procedure_type y anesthesia_type NO se exigen aquí: algunas celdas
    // reales son "comodín" para esa dimensión (ej. criptorquídeo en Santiago
    // no distingue sexo, destartraje inhalatoria no distingue especie — están
    // guardadas con esa columna en NULL a propósito). Si el dato realmente
    // hacía falta para encontrar una celda única, la búsqueda de abajo lo
    // detecta sola (0 o >1 celdas) y falla de forma segura, nunca adivinando.
    const species = (args.species || "").toLowerCase();
    if (dims.species && !species) missing.push("species");

    const weightBySpecies: string[] = dims.weight_by_species || [];
    const needsWeight = weightBySpecies.includes(species);
    if (needsWeight && (args.weight_kg === undefined || args.weight_kg === null)) {
        missing.push("weight_kg");
    }

    let tramo: string | null = null;
    if (dims.tramo) {
        if (args.travel_minutes === undefined || args.travel_minutes === null) {
            missing.push("travel_minutes");
        } else {
            const ranges: { key: string; max_minutes: number }[] = matrix.tramo_ranges || [];
            const match = ranges.find((r) => args.travel_minutes! <= r.max_minutes);
            if (!match) {
                return { success: false, message: "Fuera de rango de tramo — no hay valor automático para esta distancia. Usa escalate_to_human." };
            }
            tramo = match.key;
        }
    }

    if (missing.length > 0) {
        return { success: false, missing_fields: missing, message: `Faltan datos para calcular el precio: ${missing.join(", ")}. Pídeselos al tutor antes de reintentar.` };
    }

    // Cada dimensión matchea su valor exacto O una celda "comodín" (NULL en
    // esa columna) — nunca solo exacto. Sin esto, una celda comodín real
    // (destartraje inhalatoria de Santiago, species=NULL = "aplica a
    // cualquiera") no se encontraba nunca porque se exigía species='perro'
    // literal. Si args no trae valor para una dimensión, solo puede matchear
    // la celda comodín (nunca adivina cuál valor específico usar).
    const orNull = (col: string, val: string | undefined) =>
        val ? `${col}.eq.${val},${col}.is.null` : `${col}.is.null`;

    let q = sb.from("clinic_price_matrix_cells").select("id, price, requires_human").eq("matrix_id", matrix.id);
    if (dims.species) q = q.or(orNull("species", species || undefined));
    if (dims.sex) q = q.or(orNull("sex", args.sex));
    if (dims.procedure_type) q = q.or(orNull("procedure_type", args.procedure_type));
    if (dims.anesthesia_type) q = q.or(orNull("anesthesia_type", args.anesthesia_type));
    q = tramo ? q.eq("tramo", tramo) : q.is("tramo", null);
    if (needsWeight) {
        q = q.lte("weight_min", args.weight_kg!).gte("weight_max", args.weight_kg!);
    } else {
        q = q.is("weight_min", null).is("weight_max", null);
    }

    const { data: cells, error } = await q;

    if (error) {
        console.error("[priceMatrix] Error consultando celdas:", error);
        return { success: false, message: "Error técnico al calcular el precio. Escala a un humano." };
    }

    if (!cells || cells.length === 0) {
        return { success: false, message: "No hay una celda de precio para esta combinación exacta — escala a un humano, no inventes un valor." };
    }
    if (cells.length > 1) {
        // Dato de configuración mal cargado (brackets solapados) — nunca se
        // adivina cuál celda usar. Se deja rastro para que un admin lo revise.
        try {
            await sb.from("debug_logs").insert({
                message: "[priceMatrix] Múltiples celdas coincidentes — bracket solapado",
                payload: { clinicId, matrixKey, args, tramo, matchedCellIds: cells.map((c: any) => c.id) },
            });
        } catch { /* no crítico */ }
        return { success: false, message: "Configuración de precios ambigua para esta combinación — escala a un humano. (Ya se registró para revisión.)" };
    }

    const cell = cells[0];
    if (cell.requires_human || cell.price === null) {
        return { success: false, requires_human: true, message: "Esta combinación no tiene un precio automático definido todavía — usa escalate_to_human para que Claudia lo confirme." };
    }

    let total = Number(cell.price);
    const breakdownParts = [`Base ${money(total)}`];

    const { data: modifiers } = await sb
        .from("clinic_price_matrix_modifiers")
        .select("label, amount, applies_when")
        .eq("matrix_id", matrix.id);

    for (const mod of modifiers || []) {
        const cond = mod.applies_when || {};
        const applies = Object.keys(cond).every((k) => String((args as any)[k] ?? "") === String(cond[k]));
        if (applies && mod.amount) {
            total += Number(mod.amount);
            breakdownParts.push(`+ ${money(mod.amount)} (${mod.label})`);
        }
    }

    return {
        success: true,
        price_total: total,
        tramo: tramo || undefined,
        breakdown: breakdownParts.join(" "),
        message: `Usa EXCLUSIVAMENTE price_total (${money(total)}) como el valor a comunicar. No lo recalcules ni lo ajustes.`,
    };
}

/** Matriz cacheada por clínica — para inyectar en el prompt qué matrices existen y qué piden. */
export interface ClinicMatrixSummary {
    id: string;
    matrix_key: string;
    label: string;
    dimensions_used: Record<string, any>;
}

const matrixCache = new Map<string, { matrices: ClinicMatrixSummary[]; fetchedAt: number }>();
const MATRIX_CACHE_TTL_MS = 5 * 60 * 1000;

/** Lista las matrices activas de una clínica, cacheada 5 min (mismo patrón que kbCache). */
export async function getClinicPriceMatrices(sb: any, clinicId: string): Promise<ClinicMatrixSummary[]> {
    const cached = matrixCache.get(clinicId);
    if (cached && Date.now() - cached.fetchedAt < MATRIX_CACHE_TTL_MS) return cached.matrices;

    const { data } = await sb
        .from("clinic_price_matrices")
        .select("id, matrix_key, label, dimensions_used")
        .eq("clinic_id", clinicId)
        .eq("status", "active");

    const matrices = data || [];
    matrixCache.set(clinicId, { matrices, fetchedAt: Date.now() });
    return matrices;
}

const DIMENSION_LABELS: Record<string, string> = {
    species: "species (perro/gato)",
    sex: "sex (hembra/macho)",
    procedure_type: "procedure_type (esterilizacion/castracion/criptorquideo)",
    anesthesia_type: "anesthesia_type (inyectable/inhalatoria)",
    tramo: "travel_minutes (minutos al centro/pabellón más cercano, de tu contexto)",
};

/** Bloque de texto para el prompt: qué matrices tiene esta clínica y qué argumentos requiere cada una. */
export function buildMatrixPromptBlock(matrices: ClinicMatrixSummary[]): string {
    if (matrices.length === 0) return "";
    const lines = matrices.map((m) => {
        const dims = m.dimensions_used || {};
        const required = Object.keys(DIMENSION_LABELS).filter((k) => dims[k]).map((k) => DIMENSION_LABELS[k]);
        if ((dims.weight_by_species || []).length > 0) {
            required.push(`weight_kg (obligatorio si species es ${dims.weight_by_species.join(" o ")})`);
        }
        return `- matrix_key: "${m.matrix_key}" (${m.label}) — requiere: ${required.join(", ") || "solo species"}.`;
    });
    return `\n\nMATRICES DE PRECIO — usa SIEMPRE calculate_matrix_price para estos servicios, JAMÁS calcules ni leas una tabla a mano:\n${lines.join("\n")}`;
}
