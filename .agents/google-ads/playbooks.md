# Playbooks operativos — Google Ads Vetly

Cuatro rutinas. Cada una termina con la **orden de cambio** definida en `.claude/agents/google-ads.md`.

---

## P1 · Lanzamiento

No se crea una sola campaña antes de cerrar esto. El orden es estricto porque cada paso invalida al
siguiente si falla.

**Paso 0 — Validar que la conversión registra de verdad.**
No basta con que la acción `Registro` exista en la cuenta. Hay que completar un registro real en
vetly.pro con el plan Core y confirmar que aparece en Google Ads (tarda hasta 24 h en reflejarse en
la columna de conversiones, pero el diagnóstico de la etiqueta es inmediato). Si no llega, no se
lanza: se arregla el tracking.

**Paso 1 — Higiene de cuenta.** Correr P4 completa. Display apagado, geo por presencia, negativas
cargadas a nivel cuenta (sección 7.3 del brief), autoetiquetado `gclid` activo.

**Paso 2 — C1 y C2 en borrador.** Solo esas dos. Con menos de USD 5/día no se sostienen más de dos
campañas sin matarlas de hambre.

- `C1 · [CL] Search — Gestión Veterinaria (Genéricas)` — 40% del presupuesto
- `C2 · [CL] Search — Veterinario a Domicilio e Independiente` — 25%

Ambas: Maximizar clics con tope de CPC, ubicación Chile por presencia, idioma español, Display y
socios apagados, RSAs de las secciones 8.1 y 8.2 del brief, extensiones de la 8.5.

**Paso 3 — Orden de cambio.** El usuario activa. Nunca tú.

**Después del lanzamiento:** C3 y C5 en la semana 2; C4 en la semana 6 junto con `/core/comparar`;
México (C6) solo si Chile validó CPA.

---

## P2 · Limpieza de términos de búsqueda

Diaria durante el mes 1, dos veces por semana después. Es el 80% del trabajo del primer mes y lo que
más dinero salva.

1. `get_google_ads_search_terms_report` de los últimos 1–7 días.
2. Clasificar cada término:
   - **Irrelevante** → negativa inmediata al nivel que corresponda (cuenta si es estructural,
     campaña si es específica).
   - **Relevante y convierte** → añadir como keyword propia en concordancia de frase o exacta.
   - **Relevante pero no convierte** → dejar correr, anotar, revisar en P3.
3. Vigilar en particular las cuatro fugas conocidas del brief: equipamiento veterinario (crítico en
   México), intención académica, empleo, y **dueños de mascota** — esta última es la más cara,
   porque el término parece relevante pero el que busca no compra software.
4. Actualizar el conteo de negativas en `estado-cuenta.md`.

---

## P3 · Revisión de rendimiento

Semanal a partir de la semana 4.

**Podar:**
- Keyword con >40 clics y 0 conversiones → pausar.
- Campaña sin ninguna conversión en 60 clics → pausar y revisar la landing antes que el anuncio.

**Escalón de puja** (no saltarse pasos):

| Situación | Estrategia |
|---|---|
| Sin histórico | Maximizar clics con CPC tope |
| ≥15 conv./mes | Maximizar conversiones, sin tCPA |
| ≥30 conv./mes | tCPA en el rango objetivo |

Los cambios de estrategia y de presupuesto van en la orden de cambio: no tienes la herramienta para
aplicarlos.

**Leer también:** rendimiento por dispositivo (el registro a un SaaS de gestión suele completarse en
escritorio), por hora (probable pico 20:00–23:00, el veterinario administra de noche) y por
ubicación.

**Diagnóstico antes de culpar a la campaña:** si el CPA se dispara pero el CTR es sano y el CVR de
la landing cayó, el problema es la landing. Cargar `cro`, no subir la puja.

---

## P4 · Auditoría de cuenta

Al empezar, y una vez al mes.

- [ ] `get_google_ads_campaigns` → ninguna campaña con `target_content_network: true`
- [ ] Ninguna con `target_search_network` o `target_partner_search_network` en true
- [ ] Geo configurada por **presencia**, no por interés
- [ ] Idioma: español
- [ ] Negativas de la sección 7.3 del brief cargadas a nivel cuenta
- [ ] Autoetiquetado (`gclid`) activo — sin esto no hay importación offline
- [ ] Una sola conversión marcada como principal (`Registro`)
- [ ] Sin conversiones duplicadas contando el mismo evento dos veces
- [ ] Ninguna campaña Performance Max activa mientras haya <30 conv./mes
- [ ] Presupuestos en CLP coherentes con el objetivo mensual en USD

Cerrar actualizando `estado-cuenta.md` con lo que encontraste.
