-- ============================================================================
-- Bloque de fidelización para `ai_behavior_rules` — Linares y Santiago
--
-- ⚠️ NO EJECUTADO TODAVÍA. Aplicar solo cuando el frontend esté desplegado:
--    el agente empezaría a prometer acumulación antes de que la caja pueda
--    canjearla, y los clientes reclamarían un saldo que nadie puede usar.
--
-- Estos campos viven SOLO en la base de datos (no en migraciones del repo, por
-- la regla del proyecto). Se cargan dinámicamente en cada request del webhook:
-- aplicar este script surte efecto en la siguiente conversación, sin deploy.
--
-- Ancla de inserción: 'AVISO DE RANGO HORARIO (OBLIGATORIO)', el cierre
-- obligatorio de toda cita agendada. Verificado presente e idéntico en ambas
-- clínicas (posición 3743 en Linares, 3897 en Santiago).
--
-- Costo: ~1.000 caracteres sobre prompts de 38.608 y 33.678 (≈ +2,7%). Cada
-- carácter viaja en cada llamada a OpenAI, por eso el bloque es corto.
-- ============================================================================

-- ── 1. Respaldo obligatorio antes de tocar el prompt ───────────────────────
INSERT INTO prompt_backups (clinic_id, field, content, label)
SELECT id, 'ai_behavior_rules', ai_behavior_rules, 'pre_fidelizacion_2026_08_13'
FROM clinic_settings
WHERE id IN ('fd11b7e4-7d96-461c-a292-2caa5e2592ce',
             '13472ea4-4da6-461c-9a80-a5c970d9ec73');

-- ── 2. Inserción del bloque ────────────────────────────────────────────────
-- Se ancla al final de la frase del aviso de rango horario para que el orden de
-- lectura del modelo sea: confirmo cita -> aviso de rango -> programa -> cierre.
UPDATE clinic_settings
SET ai_behavior_rules = REPLACE(
    ai_behavior_rules,
    E'por si ocurre algún retraso en la ruta.\'\n',
    E'por si ocurre algún retraso en la ruta.\'\n\n'
    || E'* **PROGRAMA PESOS ANIMALGRACE (CIERRE DE AGENDAMIENTO):** Justo después del aviso de rango horario, cierra con UNA sola frase breve, nunca un párrafo: "Además, desde tu segunda visita acumulas automáticamente el 5% del total de cada atención en Pesos AnimalGrace, que puedes usar cuando quieras para descontar de futuras visitas 🐾". Si ya lo mencionaste antes en esta conversación, no lo repitas.\n'
    || E'* **FICHA DIGITAL:** Si preguntan por su saldo, sus Pesos AnimalGrace, cómo recomendar, o sus próximas atenciones, entrega el enlace de Ficha Digital que aparece en el bloque [FIDELIZACIÓN] del contexto. Ahí ve todo: saldo, enlace para recomendar, historial médico y próximas visitas. Ofrécelo también, de forma natural, cuando el cliente muestre interés en el programa.\n'
    || E'* **⚠️ PROHIBIDO INVENTAR SALDOS (ABSOLUTO):** Menciona un monto de Pesos AnimalGrace SOLO si aparece explícitamente en el bloque [FIDELIZACIÓN] del contexto del sistema. Si no aparece, di que puede revisarlo en su Ficha Digital. NUNCA estimes, calcules ni inventes un saldo.\n'
    || E'* **RECOMENDAR A UN AMIGO:** Quien comparte su enlace gana $5.000 en Pesos AnimalGrace cuando su recomendado se atiende por primera vez, y ese nuevo cliente recibe el 15% de esa primera atención. El premio se paga con la atención, no por mandar el código.\n'
)
WHERE id IN ('fd11b7e4-7d96-461c-a292-2caa5e2592ce',
             '13472ea4-4da6-461c-9a80-a5c970d9ec73');

-- ── 3. Verificación ────────────────────────────────────────────────────────
-- Debe devolver 2 filas con `ok = true` y el crecimiento esperado de longitud.
SELECT clinic_name,
       (ai_behavior_rules LIKE '%PESOS ANIMALGRACE%') AS ok,
       length(ai_behavior_rules) AS len_nuevo
FROM clinic_settings
WHERE id IN ('fd11b7e4-7d96-461c-a292-2caa5e2592ce',
             '13472ea4-4da6-461c-9a80-a5c970d9ec73');

-- ── Reversión ──────────────────────────────────────────────────────────────
-- UPDATE clinic_settings cs SET ai_behavior_rules = pb.content
-- FROM prompt_backups pb
-- WHERE pb.clinic_id = cs.id AND pb.field = 'ai_behavior_rules'
--   AND pb.label = 'pre_fidelizacion_2026_08_13';
