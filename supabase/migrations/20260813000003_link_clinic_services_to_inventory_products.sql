-- Las vacunas (y otros insumos) existían duplicadas: como servicio en
-- clinic_services Y como producto en inventory_products, con el mismo precio.
-- Santiago las vendía como producto y Linares como servicio, así que los
-- reportes de las dos sucursales no eran comparables.
--
-- Solución: el servicio es el concepto facturable (el ingreso se atribuye al
-- servicio) y opcionalmente consume N unidades de un producto del inventario,
-- que es lo único que necesita control de stock.

ALTER TABLE public.clinic_services
  ADD COLUMN IF NOT EXISTS linked_product_id UUID REFERENCES public.inventory_products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_product_qty NUMERIC NOT NULL DEFAULT 1
    CHECK (linked_product_qty > 0);

CREATE INDEX IF NOT EXISTS idx_clinic_services_linked_product
  ON public.clinic_services(linked_product_id) WHERE linked_product_id IS NOT NULL;

COMMENT ON COLUMN public.clinic_services.linked_product_id IS
  'Producto del inventario que se consume al vender este servicio (ej. servicio "Vacuna Antirrábica" consume 1 unidad del producto "Vacuna antirrábica"). El ingreso se atribuye al SERVICIO; el producto solo se descuenta del stock.';
COMMENT ON COLUMN public.clinic_services.linked_product_qty IS
  'Unidades del producto vinculado que consume una venta del servicio. Default 1.';
