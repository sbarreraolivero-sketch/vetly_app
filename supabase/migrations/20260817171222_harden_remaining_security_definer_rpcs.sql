-- Aplicada vía MCP el 2026-08-17. Cierra los residuos de la fuga de RPCs.

-- 1) get_all_clinics_usage: exponía métricas de TODAS las clínicas de la
--    plataforma a cualquier usuario autenticado. Es una vista de HQ.
CREATE OR REPLACE FUNCTION public.get_all_clinics_usage()
RETURNS TABLE(clinic_id uuid, clinic_name text, plan text, monthly_mini_limit integer,
              monthly_mini_used integer, monthly_4o_limit integer, monthly_4o_used integer,
              extra_balance integer, extra_4o_balance integer, active_model text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_platform_admin() THEN
      RAISE EXCEPTION 'Unauthorized: platform admin access required';
    END IF;
    RETURN QUERY
    SELECT cs.id, cs.clinic_name, cs.subscription_plan,
           cs.ai_credits_monthly_limit, cs.ai_credits_monthly_mini_used,
           cs.ai_credits_monthly_4o_limit, cs.ai_credits_monthly_4o_used,
           cs.ai_credits_extra_balance, cs.ai_credits_extra_4o, cs.ai_active_model
    FROM public.clinic_settings cs;
END;
$function$;

-- 2) increment_subscription_usage: construía el UPDATE con format(%I) sobre un
--    nombre de columna recibido del cliente. %I evita la inyección clásica, pero
--    permitía tocar CUALQUIER columna de subscriptions (incluidos los límites del
--    plan). Se acota a contadores de uso reales (_used) y se exige membresía.
CREATE OR REPLACE FUNCTION public.increment_subscription_usage(clinic_uuid uuid, column_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_clinic_member(clinic_uuid) THEN
      RAISE EXCEPTION 'Acceso denegado';
    END IF;

    IF column_name !~ '^[a-z_]+_used$'
       OR NOT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'subscriptions'
           AND columns.column_name = increment_subscription_usage.column_name
       ) THEN
      RAISE EXCEPTION 'Columna no permitida: %', column_name;
    END IF;

    EXECUTE format('UPDATE public.subscriptions SET %I = COALESCE(%I, 0) + 1 WHERE clinic_id = $1',
                   column_name, column_name) USING clinic_uuid;
END;
$function$;

-- 3) transfer_inventory: sin control, cualquiera podía mover stock de otra
--    clínica. Se exige membresía y que ambas ubicaciones y el producto sean de
--    esa clínica (si no, se podría sacar stock hacia una bodega ajena).
CREATE OR REPLACE FUNCTION public.transfer_inventory(p_clinic_id uuid, p_product_id uuid,
    p_from_location_id uuid, p_to_location_id uuid, p_quantity numeric, p_notes text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_from_stock NUMERIC;
BEGIN
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_clinic_member(p_clinic_id) THEN
      RAISE EXCEPTION 'Acceso denegado';
    END IF;

    IF (SELECT count(*) FROM public.inventory_locations
        WHERE id IN (p_from_location_id, p_to_location_id) AND clinic_id = p_clinic_id) <> 2 THEN
      RAISE EXCEPTION 'Ubicación de origen o destino no pertenece a esta clínica';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.inventory_products
                   WHERE id = p_product_id AND clinic_id = p_clinic_id) THEN
      RAISE EXCEPTION 'El producto no pertenece a esta clínica';
    END IF;

    SELECT quantity INTO v_from_stock FROM public.inventory_stock
    WHERE product_id = p_product_id AND location_id = p_from_location_id;

    IF v_from_stock IS NULL OR v_from_stock < p_quantity THEN
        RAISE EXCEPTION 'Stock insuficiente en el origen (disponible: %)', COALESCE(v_from_stock, 0);
    END IF;

    INSERT INTO public.inventory_movements (clinic_id, product_id, location_id, type, quantity, notes)
    VALUES (p_clinic_id, p_product_id, p_from_location_id, 'transfer_out', -p_quantity, p_notes);
    INSERT INTO public.inventory_movements (clinic_id, product_id, location_id, type, quantity, notes)
    VALUES (p_clinic_id, p_product_id, p_to_location_id, 'transfer_in', p_quantity, p_notes);
END;
$function$;

-- 4) save_transaction_items: dos de los tres overloads no verificaban nada, y
--    ninguno acotaba el UPDATE por clinic_id — con el UUID de una cita ajena se
--    le podía reescribir precio, descuento y método de pago.
CREATE OR REPLACE FUNCTION public.save_transaction_items(p_appointment_id uuid, p_clinic_id uuid,
    p_items jsonb, p_price numeric, p_discount numeric DEFAULT 0, p_payment_method text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_clinic_member(p_clinic_id) THEN
      RAISE EXCEPTION 'Acceso denegado';
    END IF;
    DELETE FROM public.appointment_items
     WHERE appointment_id = p_appointment_id AND clinic_id = p_clinic_id;
    INSERT INTO public.appointment_items
        (appointment_id, clinic_id, item_type, name, quantity, unit_price, subtotal, product_id)
    SELECT p_appointment_id, p_clinic_id, (el->>'item_type')::TEXT, (el->>'name')::TEXT,
           (el->>'quantity')::NUMERIC, (el->>'unit_price')::NUMERIC, (el->>'subtotal')::NUMERIC,
           CASE WHEN el->>'product_id' IS NOT NULL THEN (el->>'product_id')::UUID ELSE NULL END
    FROM jsonb_array_elements(p_items) AS el;
    UPDATE public.appointments SET price = p_price, discount = p_discount,
           payment_method = p_payment_method
     WHERE id = p_appointment_id AND clinic_id = p_clinic_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_transaction_items(p_appointment_id uuid, p_clinic_id uuid,
    p_items jsonb, p_price numeric, p_discount numeric DEFAULT 0, p_payment_method text DEFAULT NULL::text,
    p_discount_reason text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_clinic_member(p_clinic_id) THEN
      RAISE EXCEPTION 'Acceso denegado';
    END IF;
    DELETE FROM public.appointment_items
     WHERE appointment_id = p_appointment_id AND clinic_id = p_clinic_id;
    INSERT INTO public.appointment_items
        (appointment_id, clinic_id, item_type, name, quantity, unit_price, subtotal, product_id)
    SELECT p_appointment_id, p_clinic_id, (item->>'item_type')::TEXT, (item->>'name')::TEXT,
           (item->>'quantity')::NUMERIC, (item->>'unit_price')::NUMERIC, (item->>'subtotal')::NUMERIC,
           (item->>'product_id')::UUID
    FROM jsonb_array_elements(p_items) AS item;
    UPDATE public.appointments SET price = p_price, discount = p_discount,
           payment_method = p_payment_method, discount_reason = p_discount_reason
     WHERE id = p_appointment_id AND clinic_id = p_clinic_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_transaction_items(p_appointment_id uuid, p_clinic_id uuid,
    p_items jsonb, p_price numeric, p_discount numeric DEFAULT 0, p_payment_method text DEFAULT NULL::text,
    p_discount_reason text DEFAULT NULL::text, p_iva_amount numeric DEFAULT NULL::numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_clinic_member(p_clinic_id) THEN
      RAISE EXCEPTION 'Acceso denegado';
    END IF;
    DELETE FROM public.appointment_items
     WHERE appointment_id = p_appointment_id AND clinic_id = p_clinic_id;
    INSERT INTO public.appointment_items
        (appointment_id, clinic_id, item_type, name, quantity, unit_price, subtotal, product_id)
    SELECT p_appointment_id, p_clinic_id, (item->>'item_type')::TEXT, (item->>'name')::TEXT,
           (item->>'quantity')::NUMERIC, (item->>'unit_price')::NUMERIC, (item->>'subtotal')::NUMERIC,
           (item->>'product_id')::UUID
    FROM jsonb_array_elements(p_items) AS item;
    UPDATE public.appointments SET price = p_price, discount = p_discount,
           payment_method = p_payment_method, discount_reason = p_discount_reason,
           iva_amount = p_iva_amount
     WHERE id = p_appointment_id AND clinic_id = p_clinic_id;
END;
$function$;

-- CREATE OR REPLACE reinstala los privilegios por defecto: revocar de nuevo.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND p.proname NOT IN ('get_pet_owner_portal','get_referral_link_data','mark_diagnostic_wa_clicked')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;
