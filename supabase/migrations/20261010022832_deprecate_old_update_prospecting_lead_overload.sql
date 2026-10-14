-- Al agregar los 4 parámetros nuevos (B/C) a update_prospecting_lead, un
-- CREATE OR REPLACE con una firma distinta no reemplaza la función: crea una
-- sobrecarga nueva y deja viva la antigua (misma trampa ya documentada en el
-- proyecto — CLAUDE.md sesión 68). Una llamada con los 5 argumentos
-- originales calzaría con ambas firmas y Postgres resolvería de forma
-- ambigua o hacia la vieja, sin tocar los campos B/C nunca.
--
-- DROP de la firma antigua (5 parámetros exactos) — la única que queda es la
-- de 9 parámetros (4 con DEFAULT NULL), que cubre el caso de llamar con solo
-- los primeros 5 argumentos igual.

DROP FUNCTION IF EXISTS public.update_prospecting_lead(uuid, text, text, text, text);
