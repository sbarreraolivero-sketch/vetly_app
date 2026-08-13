-- Las vacunas existían duplicadas como servicio y como producto de inventario, y
-- Santiago las registraba eligiendo el PRODUCTO. Eso inflaba "Ventas con
-- productos" (55% aparente vs ~13% de venta cruzada verdadera) y las mostraba en
-- "Top Productos" en vez de "Top Servicios", haciendo que las dos sucursales no
-- fueran comparables (Linares siempre las registró como servicio, y marca 13%).
--
-- Se reclasifican las ventas históricas: type 'product' -> 'service', y el id/name
-- pasan a apuntar al servicio equivalente del catálogo. Los 4 productos-vacuna
-- afectados tienen match 1:1 con su servicio, con precio idéntico:
--   Vacuna antirrábica            -> Vacuna Antirrábica        ($23.000)
--   Vacuna Leucemia viral felina  -> Vacuna Leucemia Felina    ($25.000)
--   Vacuna sextuple               -> Vacuna Sextuple/Octuple   ($23.000)
--   Vacuna triple felina          -> Vacuna triple Felina      ($25.000)
--
-- Los movimientos de inventario ya generados NO se tocan a propósito: la vacuna
-- física se consumió igual, independiente de cómo se clasifique el ingreso.
--
-- Los montos no cambian: verificado que el total del mes y la suma por tipo
-- siguen cuadrando exactamente ($1.639.500 en Santiago, antes y después).

CREATE TABLE IF NOT EXISTS public.incomes_services_backup (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    income_id   UUID NOT NULL,
    services    JSONB,
    category    TEXT,
    label       TEXT NOT NULL,
    backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.incomes_services_backup ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS incomes_services_backup_service_role ON public.incomes_services_backup;
CREATE POLICY incomes_services_backup_service_role ON public.incomes_services_backup
    FOR ALL TO service_role USING (true) WITH CHECK (true);

WITH map(pid, sid, sname) AS (VALUES
    ('7f3d6ef8-bff0-4068-bbaa-f33a9ccd1a05','217c32c8-a826-4b84-a982-17f2e670a534','Vacuna Antirrábica'),
    ('9aff3c75-fea4-4c63-8407-6081f445fa33','f12d4efb-67e3-4292-a09c-0c5392965070','Vacuna Leucemia Felina'),
    ('f640491f-cff4-48fa-9bbf-bf613873c341','b2e69d88-29f4-4a78-80b4-45c1c346d2e8','Vacuna Sextuple/Octuple'),
    ('7c0f80d9-6f08-435c-9c7d-d384bb34cf61','6e90675f-2a7a-45e9-9da5-fd79b968ab85','Vacuna triple Felina')
),
affected AS (
    SELECT DISTINCT i.id
    FROM public.incomes i
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.services,'[]'::jsonb)) e
    JOIN map m ON m.pid = e->>'id'
    WHERE e->>'type' = 'product'
)
INSERT INTO public.incomes_services_backup (income_id, services, category, label)
SELECT i.id, i.services, i.category, 'pre_vacunas_reclasificacion_2026_08_13'
FROM public.incomes i JOIN affected a ON a.id = i.id;

WITH map(pid, sid, sname) AS (VALUES
    ('7f3d6ef8-bff0-4068-bbaa-f33a9ccd1a05','217c32c8-a826-4b84-a982-17f2e670a534','Vacuna Antirrábica'),
    ('9aff3c75-fea4-4c63-8407-6081f445fa33','f12d4efb-67e3-4292-a09c-0c5392965070','Vacuna Leucemia Felina'),
    ('f640491f-cff4-48fa-9bbf-bf613873c341','b2e69d88-29f4-4a78-80b4-45c1c346d2e8','Vacuna Sextuple/Octuple'),
    ('7c0f80d9-6f08-435c-9c7d-d384bb34cf61','6e90675f-2a7a-45e9-9da5-fd79b968ab85','Vacuna triple Felina')
),
affected AS (
    SELECT DISTINCT i.id
    FROM public.incomes i
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.services,'[]'::jsonb)) e
    JOIN map m ON m.pid = e->>'id'
    WHERE e->>'type' = 'product'
),
rebuilt AS (
    -- WITH ORDINALITY + ORDER BY para no alterar el orden de los ítems del ingreso.
    SELECT i.id,
           jsonb_agg(
               CASE WHEN e->>'type' = 'product' AND m.pid IS NOT NULL
                    THEN e || jsonb_build_object('type','service','id',m.sid,'name',m.sname)
                    ELSE e END
               ORDER BY ord
           ) AS new_services
    FROM public.incomes i
    JOIN affected a ON a.id = i.id
    CROSS JOIN LATERAL jsonb_array_elements(i.services) WITH ORDINALITY AS t(e, ord)
    LEFT JOIN map m ON m.pid = e->>'id' AND e->>'type' = 'product'
    GROUP BY i.id
)
UPDATE public.incomes i
SET services = r.new_services
FROM rebuilt r
WHERE i.id = r.id;

-- La categoría del ingreso se auto-calcula como 'product' solo cuando no hay
-- ningún servicio; tras la reclasificación esos ingresos pasan a ser de servicio.
UPDATE public.incomes i
SET category = 'service'
WHERE i.category = 'product'
  AND EXISTS (SELECT 1 FROM public.incomes_services_backup b
              WHERE b.income_id = i.id AND b.label = 'pre_vacunas_reclasificacion_2026_08_13')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(i.services,'[]'::jsonb)) e
              WHERE e->>'type' = 'service');
