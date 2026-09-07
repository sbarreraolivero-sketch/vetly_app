-- _consent_template_library no toca ninguna tabla (solo VALUES literales), pero
-- el linter marca search_path mutable. Fijarlo silencia el WARN.
-- (Aplicado vía MCP como CREATE OR REPLACE con SET search_path = ''; acá el
-- ALTER equivalente para que un reset lo reproduzca.)
ALTER FUNCTION public._consent_template_library() SET search_path = '';
