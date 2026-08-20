import { supabase } from '@/lib/supabase'
import type { InventoryProduct, InventoryMovement, AppointmentItem } from '@/types/database'

export type { InventoryProduct, InventoryMovement, AppointmentItem }

export interface InventoryLocation {
    id: string
    clinic_id: string
    name: string
    type: 'warehouse' | 'vehicle'
    is_active_for_sales: boolean
    is_default: boolean
    created_at: string
}

export interface ProductWithMovement extends InventoryProduct {
    last_movement_at?: string | null
    days_since_movement?: number | null
}

export interface AbcProduct {
    product_id: string
    product_name: string
    category: string
    unit: string
    total_sold: number
    total_revenue: number
    revenue_pct: number
    abc_class: 'A' | 'B' | 'C'
}

export interface NoRotationProduct {
    product_id: string
    product_name: string
    category: string
    stock_quantity: number
    last_movement_at: string | null
    days_no_movement: number
}

export interface VisitItem {
    id: string             // temp client ID
    item_type: 'service' | 'product'
    name: string
    quantity: number
    unit_price: number
    subtotal: number
    product_id?: string | null
}

export const inventoryService = {

    // ── Ubicaciones ────────────────────────────────────────────────────

    async getLocations(clinicId: string): Promise<InventoryLocation[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .from('inventory_locations')
            .select('*')
            .eq('clinic_id', clinicId)
            .order('created_at', { ascending: true })
        if (error) throw error
        return data ?? []
    },

    async createLocation(clinicId: string, name: string, type: 'warehouse' | 'vehicle'): Promise<InventoryLocation> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .from('inventory_locations')
            .insert({ clinic_id: clinicId, name, type, is_active_for_sales: false, is_default: false })
            .select()
            .single()
        if (error) throw error
        return data
    },

    async updateLocation(id: string, updates: Partial<Pick<InventoryLocation, 'name' | 'type'>>): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
            .from('inventory_locations')
            .update(updates)
            .eq('id', id)
        if (error) throw error
    },

    // Solo una ubicación puede ser activa para ventas a la vez
    async setActiveForSales(locationId: string, clinicId: string): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sb = supabase as any
        await sb.from('inventory_locations').update({ is_active_for_sales: false }).eq('clinic_id', clinicId)
        const { error } = await sb.from('inventory_locations').update({ is_active_for_sales: true }).eq('id', locationId)
        if (error) throw error
    },

    async getActiveForSalesLocation(clinicId: string): Promise<InventoryLocation | null> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase as any)
            .from('inventory_locations')
            .select('*')
            .eq('clinic_id', clinicId)
            .eq('is_active_for_sales', true)
            .maybeSingle()
        return data ?? null
    },

    // Devuelve mapa productId → quantity para una ubicación específica
    async getLocationStockMap(locationId: string): Promise<Map<string, number>> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .from('inventory_stock')
            .select('product_id, quantity')
            .eq('location_id', locationId)
        if (error) throw error
        const map = new Map<string, number>()
        for (const row of data ?? []) map.set(row.product_id, row.quantity)
        return map
    },

    async transferStock(params: {
        clinicId: string
        productId: string
        fromLocationId: string
        toLocationId: string
        quantity: number
        notes?: string
    }): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any).rpc('transfer_inventory', {
            p_clinic_id:        params.clinicId,
            p_product_id:       params.productId,
            p_from_location_id: params.fromLocationId,
            p_to_location_id:   params.toLocationId,
            p_quantity:         params.quantity,
            p_notes:            params.notes ?? null,
        })
        if (error) throw error
    },

    // ── Productos ──────────────────────────────────────────────────────

    // Solo productos vendibles — usado por VisitClosureModal
    async getProducts(clinicId: string): Promise<InventoryProduct[]> {
        const { data, error } = await supabase
            .from('inventory_products')
            .select('*')
            .eq('clinic_id', clinicId)
            .eq('is_active', true)
            .eq('is_for_sale', true)
            .order('name')
        if (error) throw error
        return data ?? []
    },

    async getAllProducts(clinicId: string): Promise<InventoryProduct[]> {
        const { data, error } = await supabase
            .from('inventory_products')
            .select('*')
            .eq('clinic_id', clinicId)
            .order('name')
        if (error) throw error
        return data ?? []
    },

    async createProduct(product: Omit<InventoryProduct, 'id' | 'created_at' | 'updated_at'>): Promise<InventoryProduct> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .from('inventory_products')
            .insert(product)
            .select()
            .single()
        if (error) throw error
        return data
    },

    async updateProduct(id: string, updates: Partial<InventoryProduct>): Promise<InventoryProduct> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .from('inventory_products')
            .update(updates)
            .eq('id', id)
            .select()
            .single()
        if (error) throw error
        return data
    },

    async deleteProduct(id: string): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
            .from('inventory_products')
            .delete()
            .eq('id', id)
        if (error) throw error
    },

    // ── Movimientos ────────────────────────────────────────────────────

    async getMovements(
        clinicId: string,
        filters?: { productId?: string; type?: string; startDate?: string; endDate?: string }
    ): Promise<(InventoryMovement & { product_name?: string })[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q = (supabase as any)
            .from('inventory_movements')
            .select('*, inventory_products(name)')
            .eq('clinic_id', clinicId)
            .order('created_at', { ascending: false })
            .limit(200)

        if (filters?.productId) q = q.eq('product_id', filters.productId)
        if (filters?.type)      q = q.eq('type', filters.type)
        if (filters?.startDate) q = q.gte('created_at', filters.startDate)
        if (filters?.endDate)   q = q.lte('created_at', filters.endDate)

        const { data, error } = await q
        if (error) throw error
        return (data ?? []).map((m: any) => ({
            ...m,
            product_name: m.inventory_products?.name,
        }))
    },

    async addMovement(movement: Omit<InventoryMovement, 'id' | 'created_at'> & { location_id?: string | null }): Promise<InventoryMovement> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .from('inventory_movements')
            .insert(movement)
            .select()
            .single()
        if (error) throw error
        return data
    },

    // ── Cierre de visita ───────────────────────────────────────────────

    async closeVisit(params: {
        appointmentId: string
        clinicId: string
        items: VisitItem[]
        discount?: number
        discountReason?: string
        ivaAmount?: number
        finalTotal?: number
        paymentMethod: string
        paymentStatus: 'paid' | 'pending'
        tutorId?: string | null
        locationId?: string | null
    }): Promise<void> {
        const subtotal = params.items.reduce((sum, i) => sum + i.subtotal, 0)
        const discount = params.discount ?? 0
        const totalPrice = params.finalTotal ?? Math.max(0, subtotal - discount)

        // 1. Actualizar appointment
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: apptErr } = await (supabase as any)
            .from('appointments')
            .update({
                status:          'completed',
                price:           totalPrice,
                discount,
                discount_reason: params.discountReason ?? null,
                iva_amount:      params.ivaAmount ?? null,
                payment_method:  params.paymentMethod,
                payment_status:  params.paymentStatus,
            })
            .eq('id', params.appointmentId)
        if (apptErr) throw apptErr

        // 2. Insertar appointment_items
        if (params.items.length > 0) {
            const rows = params.items.map(item => ({
                appointment_id: params.appointmentId,
                clinic_id: params.clinicId,
                item_type: item.item_type,
                name: item.name,
                quantity: item.quantity,
                unit_price: item.unit_price,
                subtotal: item.subtotal,
                product_id: item.product_id ?? null,
            }))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: itemErr } = await (supabase as any)
                .from('appointment_items')
                .insert(rows)
            if (itemErr) throw itemErr
        }

        // 3. Inventory movements para productos vendidos
        const productItems = params.items.filter(i => i.item_type === 'product' && i.product_id)
        if (productItems.length > 0) {
            const movements = productItems.map(item => ({
                clinic_id: params.clinicId,
                product_id: item.product_id!,
                type: 'sale' as const,
                quantity: -item.quantity,
                unit_price: item.unit_price,
                appointment_id: params.appointmentId,
                tutor_id: params.tutorId ?? null,
                location_id: params.locationId ?? null,
            }))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: mvErr } = await (supabase as any)
                .from('inventory_movements')
                .insert(movements)
            if (mvErr) throw mvErr
        }
    },

    // ── Sync de stock para ventas registradas vía "+ Ingreso" ────────────
    // Los productos seleccionados en NewIncomeForm se guardan en incomes.services
    // pero nunca generaban un movimiento de inventario — el stock nunca se
    // descontaba. Esta función crea/reconcilia esos movimientos, idempotente
    // ante ediciones: revierte los movimientos 'sale' que quedaron ligados a
    // este income (income_id) con un 'adjustment' de signo contrario y los
    // desvincula, luego inserta un 'sale' fresco por cada producto vigente.
    // Nunca debe bloquear el guardado del ingreso — el llamador la envuelve
    // en try/catch y solo loguea si falla.
    // Recibe TODOS los ítems de la venta (no solo los productos): un servicio
    // vinculado a un producto de inventario — ej. el servicio "Vacuna Antirrábica"
    // vinculado al producto "Vacuna antirrábica" — también consume stock, aunque
    // el ingreso se atribuya al servicio.
    async syncIncomeProductMovements(params: {
        clinicId: string
        incomeId: string
        items: Array<{ id?: string; name?: string; price?: number; type?: string; quantity?: number }>
        tutorId?: string | null
        locationId?: string | null
    }): Promise<void> {
        const sb = supabase as any
        // Los ítems libres traen un id sintético ("custom-<ts>-<rand>"), no un UUID.
        const isUuid = (v: unknown): v is string =>
            typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

        // Un mismo producto puede consumirse por varias vías en la misma venta
        // (vendido directo + vinculado a un servicio): se acumulan.
        const consumption = new Map<string, { qty: number; unitPrice: number }>()
        const addConsumption = (productId: string, qty: number, unitPrice: number) => {
            const prev = consumption.get(productId)
            if (prev) prev.qty += qty
            else consumption.set(productId, { qty, unitPrice })
        }

        const items = params.items ?? []

        // 1. Productos elegidos explícitamente en la venta.
        // `it.price` es el TOTAL de la línea (unitario × cantidad), así que se divide
        // para obtener el unitario que espera addConsumption. Antes cada unidad era
        // una fila repetida del array; ahora una sola fila puede traer cantidad > 1.
        for (const it of items) {
            if (it?.type === 'product' && isUuid(it.id)) {
                const qty = Math.max(1, Number(it.quantity) || 1)
                addConsumption(it.id, qty, (Number(it.price) || 0) / qty)
            }
        }

        // 2. Servicios con producto vinculado.
        const serviceIds = items
            .filter(it => it?.type === 'service' && isUuid(it.id))
            .map(it => it.id as string)

        if (serviceIds.length > 0) {
            const { data: linked, error: linkErr } = await sb
                .from('clinic_services')
                .select('id, linked_product_id, linked_product_qty')
                .in('id', serviceIds)
                .not('linked_product_id', 'is', null)
            if (linkErr) throw linkErr

            const byId = new Map<string, any>((linked ?? []).map((s: any) => [s.id, s]))
            for (const it of items) {
                if (it?.type !== 'service' || !isUuid(it.id)) continue
                const svc = byId.get(it.id)
                if (!svc?.linked_product_id) continue
                // El consumo escala con la cantidad del servicio vendido: 3 vacunas
                // aplicadas consumen 3 dosis del producto vinculado, no una.
                const qty = (Number(svc.linked_product_qty) || 1) * Math.max(1, Number(it.quantity) || 1)
                // El precio se reparte entre las unidades consumidas para que el
                // análisis ABC de inventario no infle los ingresos del producto.
                addConsumption(svc.linked_product_id, qty, (Number(it.price) || 0) / qty)
            }
        }

        const { data: existing, error: fetchErr } = await sb
            .from('inventory_movements')
            .select('id, product_id, quantity, location_id')
            .eq('income_id', params.incomeId)
            .eq('type', 'sale')
        if (fetchErr) throw fetchErr

        if (existing && existing.length > 0) {
            const reversals = existing.map((m: any) => ({
                clinic_id:   params.clinicId,
                product_id:  m.product_id,
                type:        'adjustment' as const,
                quantity:    Math.abs(m.quantity),
                location_id: m.location_id,
                notes:       'Reversión automática por edición/eliminación de ingreso',
            }))
            const { error: revErr } = await sb.from('inventory_movements').insert(reversals)
            if (revErr) throw revErr

            const { error: detachErr } = await sb
                .from('inventory_movements')
                .update({ income_id: null })
                .eq('income_id', params.incomeId)
                .eq('type', 'sale')
            if (detachErr) throw detachErr
        }

        if (consumption.size > 0) {
            const rows = Array.from(consumption.entries()).map(([productId, c]) => ({
                clinic_id:   params.clinicId,
                product_id:  productId,
                type:        'sale' as const,
                quantity:    -c.qty,
                unit_price:  c.unitPrice,
                income_id:   params.incomeId,
                tutor_id:    params.tutorId ?? null,
                location_id: params.locationId ?? null,
            }))
            const { error: saleErr } = await sb.from('inventory_movements').insert(rows)
            if (saleErr) throw saleErr
        }
    },

    async getAppointmentItems(appointmentId: string): Promise<AppointmentItem[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .rpc('get_appointment_items', { p_appointment_id: appointmentId })
        if (error) throw error
        return data ?? []
    },

    // ── Analytics ──────────────────────────────────────────────────────

    async getAbcClassification(clinicId: string, days = 90): Promise<AbcProduct[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .rpc('get_inventory_abc', { p_clinic_id: clinicId, p_days: days })
        if (error) throw error
        return data ?? []
    },

    async getNoRotationProducts(clinicId: string, days = 30): Promise<NoRotationProduct[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .rpc('get_inventory_no_rotation', { p_clinic_id: clinicId, p_days: days })
        if (error) throw error
        return data ?? []
    },

    async getFinanceItemMetrics(clinicId: string, start: Date, end: Date) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .rpc('get_finance_item_metrics', {
                p_clinic_id: clinicId,
                p_start: start.toISOString(),
                p_end: end.toISOString(),
            })
        if (error) throw error
        return data as {
            by_type: Array<{ item_type: string; item_count: number; total_revenue: number; total_units: number }> | null
            top_services: Array<{ name: string; revenue: number; units: number }> | null
            top_products: Array<{ name: string; revenue: number; units: number }> | null
            top_custom: Array<{ name: string; revenue: number; units: number }> | null
            sale_metrics: { total_sales: number; sales_with_products: number; avg_ticket: number; total_revenue: number } | null
            /** @deprecated alias de compatibilidad de `sale_metrics` — usar ese. */
            appt_metrics: { total_appts: number; appts_with_products: number; avg_ticket: number } | null
        }
    },

    // ── Ingreso masivo desde factura analizada ─────────────────────────
    async bulkReceiveProducts(
        clinicId: string,
        items: Array<{
            name: string
            quantity: number
            purchase_price: number
            category: string
            sku?: string
        }>,
        locationId?: string | null
    ) {
        for (const item of items) {
            // Buscar si ya existe un producto con ese nombre (case-insensitive)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: existing } = await (supabase as any)
                .from('inventory_products')
                .select('id, stock_quantity')
                .eq('clinic_id', clinicId)
                .ilike('name', item.name.trim())
                .eq('is_active', true)
                .limit(1)
                .maybeSingle()

            let productId: string

            if (existing?.id) {
                // Producto ya existe: solo actualizar precio de compra si el nuevo es diferente
                productId = existing.id
                if (item.purchase_price > 0) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    await (supabase as any)
                        .from('inventory_products')
                        .update({ purchase_price: item.purchase_price })
                        .eq('id', productId)
                }
            } else {
                // Producto nuevo: crear con stock 0 (el movimiento lo actualizará)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: created, error: createError } = await (supabase as any)
                    .from('inventory_products')
                    .insert({
                        clinic_id:      clinicId,
                        name:           item.name.trim(),
                        sku:            item.sku ?? '',
                        category:       item.category,
                        unit:           'unit',
                        purchase_price: item.purchase_price,
                        sale_price:     item.purchase_price,  // precio venta = compra como default
                        stock_quantity: 0,
                        min_stock_alert: 5,
                        is_active:      true,
                    })
                    .select('id')
                    .single()

                if (createError) throw createError
                productId = created.id
            }

            // Insertar movimiento de compra — el trigger actualiza stock automáticamente
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: mvError } = await (supabase as any)
                .from('inventory_movements')
                .insert({
                    product_id:  productId,
                    clinic_id:   clinicId,
                    type:        'purchase',
                    quantity:    Math.abs(item.quantity),
                    unit_cost:   item.purchase_price,
                    notes:       'Ingreso desde análisis de factura IA',
                    location_id: locationId ?? null,
                })
            if (mvError) throw mvError
        }
    },

    // ── Estadísticas rápidas para el banner ────────────────────────────

    async getInventoryStats(clinicId: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .from('inventory_products')
            .select('id, stock_quantity, min_stock_alert, purchase_price, expiry_date, is_active')
            .eq('clinic_id', clinicId)
        if (error) throw error
        const products: any[] = data ?? []
        const active = products.filter((p: any) => p.is_active)
        const today = new Date()
        const in30 = new Date(today); in30.setDate(in30.getDate() + 30)
        return {
            total: active.length,
            lowStock: active.filter((p: any) => p.stock_quantity <= p.min_stock_alert).length,
            expiringSoon: active.filter((p: any) => {
                if (!p.expiry_date) return false
                const exp = new Date(p.expiry_date)
                return exp >= today && exp <= in30
            }).length,
            // Inversión real = costo de compra × unidades disponibles
            totalValue: active.reduce((sum: number, p: any) => sum + (p.stock_quantity * p.purchase_price), 0),
        }
    },
}
