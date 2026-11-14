-- Traspaso de VARIOS productos entre inventarios (bodega ↔ vehículo) en una
-- sola transacción: o se mueve todo, o no se mueve nada. Reutiliza
-- transfer_inventory (que valida membresía, ubicaciones, producto y stock
-- disponible en el origen) por cada línea.
CREATE OR REPLACE FUNCTION public.transfer_inventory_batch(
    p_clinic_id        uuid,
    p_from_location_id uuid,
    p_to_location_id   uuid,
    p_items            jsonb,   -- [{ "product_id": uuid, "quantity": number }]
    p_notes            text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item  jsonb;
    v_qty   numeric;
    v_count integer := 0;
    v_name  text;
    v_avail numeric;
BEGIN
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_clinic_member(p_clinic_id) THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;
    IF p_from_location_id = p_to_location_id THEN
        RAISE EXCEPTION 'El origen y el destino deben ser distintos';
    END IF;
    IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'No hay productos para traspasar';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_qty := (v_item->>'quantity')::numeric;
        IF v_qty IS NULL OR v_qty <= 0 THEN
            RAISE EXCEPTION 'Cantidad inválida en el traspaso';
        END IF;
        -- Validación con el NOMBRE del producto (el mensaje de transfer_inventory
        -- no lo incluye y en un lote el usuario necesita saber cuál falló).
        -- Cualquier excepción aborta TODO el lote.
        SELECT p.name, COALESCE(s.quantity, 0)
        INTO v_name, v_avail
        FROM public.inventory_products p
        LEFT JOIN public.inventory_stock s
               ON s.product_id = p.id AND s.location_id = p_from_location_id
        WHERE p.id = (v_item->>'product_id')::uuid AND p.clinic_id = p_clinic_id;
        IF v_name IS NULL THEN
            RAISE EXCEPTION 'Producto no encontrado en esta clínica';
        END IF;
        IF v_avail < v_qty THEN
            RAISE EXCEPTION 'Stock insuficiente de "%" en el origen (hay %, se pidieron %)', v_name, v_avail, v_qty;
        END IF;

        PERFORM public.transfer_inventory(
            p_clinic_id,
            (v_item->>'product_id')::uuid,
            p_from_location_id,
            p_to_location_id,
            v_qty,
            p_notes
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_inventory_batch(uuid, uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_inventory_batch(uuid, uuid, uuid, jsonb, text) TO authenticated, service_role;
