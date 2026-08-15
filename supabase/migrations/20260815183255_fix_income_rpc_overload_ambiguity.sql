-- La migración de fidelización creó create/update_clinic_income con un parámetro
-- nuevo (p_loyalty_redeemed) sin eliminar las firmas anteriores. El frontend en
-- producción llama con 12 parámetros, que satisfacen tanto la firma de 12 como la
-- de 13 (cuyo último argumento tiene DEFAULT) => PostgREST devuelve PGRST203
-- "Could not choose the best candidate function" y ningún ingreso se registra.
-- Efecto real: Finanzas quedó sin poder registrar ingresos del 13 al 15 de agosto.
--
-- La firma de 13 argumentos solo exige los 5 primeros (8 tienen DEFAULT), así que
-- cubre por sí sola todas las llamadas antiguas. Se eliminan los overloads obsoletos.

DROP FUNCTION IF EXISTS public.create_clinic_income(uuid, text, numeric, text, text);
DROP FUNCTION IF EXISTS public.create_clinic_income(uuid, text, numeric, text, text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.create_clinic_income(uuid, text, numeric, text, text, uuid, jsonb, numeric, text);
DROP FUNCTION IF EXISTS public.create_clinic_income(uuid, text, numeric, text, text, uuid, jsonb, numeric, text, text);
DROP FUNCTION IF EXISTS public.create_clinic_income(uuid, text, numeric, text, date, uuid, jsonb, numeric, text, text, text);
DROP FUNCTION IF EXISTS public.create_clinic_income(uuid, text, numeric, text, date, uuid, jsonb, numeric, text, text, text, numeric);

DROP FUNCTION IF EXISTS public.update_clinic_income(uuid, text, numeric, text, text, uuid, jsonb, numeric, text, text);
DROP FUNCTION IF EXISTS public.update_clinic_income(uuid, text, numeric, text, date, uuid, jsonb, numeric, text, text, text);
DROP FUNCTION IF EXISTS public.update_clinic_income(uuid, text, numeric, text, date, uuid, jsonb, numeric, text, text, text, numeric);
