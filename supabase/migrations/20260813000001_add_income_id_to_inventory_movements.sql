-- Los productos vendidos vía "+ Ingreso" (NewIncomeForm) nunca generaban un
-- movimiento de inventario — el stock nunca se descontaba. Esta columna permite
-- vincular movimientos 'sale' al ingreso que los originó, para poder revertirlos
-- correctamente si el ingreso se edita o se elimina (ver
-- inventoryService.syncIncomeProductMovements).

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS income_id UUID REFERENCES public.incomes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_movements_income_id
  ON public.inventory_movements(income_id) WHERE income_id IS NOT NULL;

COMMENT ON COLUMN public.inventory_movements.income_id IS
  'Links a sale movement to the manual income (incomes.id) that generated it, when the product was sold via "+ Ingreso" rather than the visit-closure flow. Cleared (SET NULL) once reconciled/reversed on edit — see inventoryService.syncIncomeProductMovements.';
