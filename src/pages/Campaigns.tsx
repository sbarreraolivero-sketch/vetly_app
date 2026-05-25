
import { useState, useEffect } from 'react'
import {
    Megaphone,
    Plus,
    Users,
    Send,
    FileText,
    X,
    Loader2,
    BarChart3,
    Trash2,
    Coins,
    ShoppingCart,
    AlertTriangle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { retentionService } from '@/services/retentionService'
import { GuideBox } from '@/components/ui/GuideBox'
import { redirectToLemonCampaignCreditsCheckout } from '@/lib/lemonsqueezy'

const CREDIT_PRICE_USD = 0.15

interface Campaign {
    id: string
    name: string
    segment_tag: string | null
    inclusion_tags: string[]
    exclusion_tags: string[]
    template_name: string
    status: 'draft' | 'scheduled' | 'sending' | 'completed' | 'failed'
    scheduled_at: string | null
    sent_count: number
    total_target: number
    created_at: string
}

interface Tag {
    id: string
    name: string
    color: string
    count?: number
}

interface YCloudTemplate {
    id: string
    name: string
    language: string
    status: string
    category: string
    body: string
}

export default function Campaigns() {
    const { profile } = useAuth()
    const [campaigns, setCampaigns] = useState<Campaign[]>([])
    const [tags, setTags] = useState<Tag[]>([])
    const [templates, setTemplates] = useState<YCloudTemplate[]>([])
    const [loading, setLoading] = useState(true)
    const [showNewCampaignModal, setShowNewCampaignModal] = useState(false)

    // New Campaign State
    const [step, setStep] = useState(1)
    const [newCampaignName, setNewCampaignName] = useState('')
    const [inclusionTags, setInclusionTags] = useState<string[]>([])
    const [exclusionTags, setExclusionTags] = useState<string[]>([])
    const [selectedTemplate, setSelectedTemplate] = useState('')
    const [estimatedAudience, setEstimatedAudience] = useState<number | null>(null)
    const [creating, setCreating] = useState(false)

    // Campaign credits
    const [campaignCredits, setCampaignCredits] = useState<number>(0)
    const [buyCreditsQty, setBuyCreditsQty] = useState(100)
    const [showBuyCredits, setShowBuyCredits] = useState(false)
    const [buyingCredits, setBuyingCredits] = useState(false)

    useEffect(() => {
        if (!profile?.clinic_id) return
        fetchCampaigns()
        fetchTags()
        fetchTemplates()
        fetchCampaignCredits()
    }, [profile?.clinic_id])

    // Detect ?payment=success on return from LS checkout
    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        if (params.get('payment') === 'success') {
            window.history.replaceState({}, '', '/app/campaigns')
            fetchCampaignCredits()
        }
    }, [])

    const fetchTemplates = async () => {
        try {
            if (profile?.clinic_id) {
                const fetchedTemplates = await retentionService.getRemoteTemplates(profile.clinic_id)
                // Filter only approved templates for campaigns
                setTemplates(fetchedTemplates.filter(t => t.status === 'APPROVED' || t.status === 'Activo-Calidad pendiente'))
            }
        } catch (error) {
            console.error('Error fetching templates:', error)
        }
    }

    const fetchCampaignCredits = async () => {
        if (!profile?.clinic_id) return
        const { data } = await (supabase as any)
            .from('subscriptions')
            .select('campaign_credits_balance')
            .eq('clinic_id', profile.clinic_id)
            .single()
        setCampaignCredits(data?.campaign_credits_balance ?? 0)
    }

    const handleBuyCredits = async () => {
        if (!profile?.clinic_id || !profile?.email) return
        setBuyingCredits(true)
        try {
            await redirectToLemonCampaignCreditsCheckout(profile.clinic_id, profile.email, buyCreditsQty)
        } catch (err: any) {
            alert(err.message || 'Error al iniciar el pago')
            setBuyingCredits(false)
        }
    }

    useEffect(() => {
        if ((inclusionTags.length > 0 || exclusionTags.length > 0) && profile?.clinic_id) {
            calculateAudience(inclusionTags, exclusionTags)
        } else {
            setEstimatedAudience(null)
        }
    }, [inclusionTags, exclusionTags, profile?.clinic_id])

    const fetchCampaigns = async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase as any)
                .from('campaigns')
                .select('*')
                .eq('clinic_id', profile?.clinic_id || '')
                .order('created_at', { ascending: false })

            if (error) throw error
            setCampaigns(data || [])
        } catch (error) {
            console.error('Error fetching campaigns:', error)
        } finally {
            setLoading(false)
        }
    }

    const fetchTags = async () => {
        try {
            if (!profile?.clinic_id) return

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase as any).rpc('get_tag_counts', {
                p_clinic_id: profile.clinic_id
            })

            if (error) throw error
            
            // Map RPC result to Tag interface — use tag_id (UUID) so audience estimation works
            const mappedTags: Tag[] = (data || []).map((t: any) => ({
                id: t.tag_id,
                name: t.tag_name,
                color: t.tag_color,
                count: Number(t.contact_count)
            }))
            
            setTags(mappedTags)
        } catch (error) {
            console.error('Error fetching tags:', error)
            
            // Fallback to legacy behavior if RPC fails
            const { data } = await (supabase as any)
                .from('tags')
                .select('*')
                .eq('clinic_id', profile?.clinic_id || '')
            setTags(data || [])
        }
    }

    const calculateAudience = async (inc: string[], exc: string[]) => {
        try {
            if (!profile?.clinic_id) return

            // If no tags selected, audience is the total count of unique contacts
            // But usually campaigns require at least one segment or exclusion.
            // If the user wants everyone, we might need a "catch-all" or check if both are empty.
            if (inc.length === 0 && exc.length === 0) {
                // Simplified total unique contacts count
                const { data: totalUnique } = await (supabase as any).rpc('get_estimated_audience', {
                    p_clinic_id: profile.clinic_id,
                    p_inclusion_tags: null,
                    p_exclusion_tags: null
                })
                setEstimatedAudience(totalUnique || 0)
                return
            }
            
            const { data, error } = await (supabase as any).rpc('get_estimated_audience', {
                p_clinic_id: profile.clinic_id,
                p_inclusion_tags: inc.length > 0 ? inc : null,
                p_exclusion_tags: exc.length > 0 ? exc : null
            })

            if (error) throw error
            setEstimatedAudience(data)
        } catch (err) {
            console.error('Error calculating audience:', err)
            setEstimatedAudience(0)
        }
    }

    const handleCreateCampaign = async () => {
        if (!profile?.clinic_id || !newCampaignName || !selectedTemplate) return
        setCreating(true)

        try {
            // 1. Create Campaign
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: campaign, error } = await (supabase as any)
                .from('campaigns')
                .insert({
                    clinic_id: profile.clinic_id,
                    name: newCampaignName,
                    inclusion_tags: inclusionTags,
                    exclusion_tags: exclusionTags,
                    template_name: selectedTemplate,
                    status: 'draft',
                    total_target: estimatedAudience || 0
                })
                .select()
                .single()

            if (error) throw error

            setCampaigns([campaign, ...campaigns])
            setShowNewCampaignModal(false)
            resetForm()

            // Trigger sending immediately? Or wait?
            // Let's auto-trigger for now if the user wanted to "Send Now".
            // Adding a "Send Now" prompt would be better.

            // For this interaction, let's just create it.
            // Then in the list, have a "Launch" button.

        } catch (error) {
            console.error('Error creating campaign:', error)
            alert('Error al crear la campaña')
        } finally {
            setCreating(false)
        }
    }

    const handleLaunchCampaign = async (campaignId: string) => {
        const campaign = campaigns.find(c => c.id === campaignId)
        const needed = campaign?.total_target ?? 0
        if (needed > campaignCredits) {
            alert(`Créditos insuficientes. Necesitas ${needed} créditos y tienes ${campaignCredits}. Compra más créditos antes de lanzar.`)
            return
        }
        if (!confirm(`¿Enviar esta campaña a ${needed} contacto${needed !== 1 ? 's' : ''}? Se usarán ${needed} crédito${needed !== 1 ? 's' : ''} de tu saldo.`)) return

        try {
            // Update status to 'sending' (or 'scheduled' if we had a date)
            // Ideally trigger Edge Function here.

            // 1. Update status
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: updateError } = await (supabase as any)
                .from('campaigns')
                .update({ status: 'sending' })
                .eq('id', campaignId)

            if (updateError) throw updateError

            // 2. Refresh list
            fetchCampaigns()

            // 3. Trigger Edge Function (fire and forget)
            // We need to implement this function next.
            await supabase.functions.invoke('send-whatsapp-campaign', {
                body: { campaign_id: campaignId }
            })

            fetchCampaignCredits()
            alert('Campaña iniciada. Los mensajes se enviarán en breve.')

        } catch (error) {
            console.error('Error launching campaign:', error)
            alert('Error al iniciar la campaña')
        }
    }

    const handleDeleteCampaign = async (campaignId: string) => {
        if (!confirm('¿Estás seguro de que deseas eliminar esta campaña?')) return

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('campaigns')
                .delete()
                .eq('id', campaignId)

            if (error) throw error

            setCampaigns(campaigns.filter(c => c.id !== campaignId))
        } catch (error) {
            console.error('Error deleting campaign:', error)
            alert('Error al eliminar la campaña')
        }
    }

    const resetForm = () => {
        setStep(1)
        setNewCampaignName('')
        setInclusionTags([])
        setExclusionTags([])
        setSelectedTemplate('')
        setEstimatedAudience(null)
    }

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed': return 'bg-emerald-100 text-emerald-700'
            case 'sending': return 'bg-blue-100 text-blue-700'
            case 'failed': return 'bg-red-100 text-red-700'
            case 'scheduled': return 'bg-amber-100 text-amber-700'
            default: return 'bg-silk-beige text-charcoal/60'
        }
    }

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'completed': return 'Completada'
            case 'sending': return 'Enviando'
            case 'failed': return 'Fallida/Parcial'
            case 'scheduled': return 'Programada'
            default: return 'Borrador'
        }
    }

    return (
        <div className="space-y-6">
            {/* Banner */}
            <div className="bg-gradient-to-br from-violet-500 to-violet-700 rounded-2xl overflow-hidden shadow-soft-md">
                <div className="p-5 sm:p-8">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-black uppercase tracking-widest text-violet-200 mb-1">Marketing</p>
                            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white leading-tight">Campañas de Marketing</h1>
                            <p className="text-sm text-violet-100/80 font-light mt-1.5">Mensajes masivos por WhatsApp segmentados por etiquetas.</p>
                            <button
                                onClick={() => setShowNewCampaignModal(true)}
                                className="mt-4 sm:hidden flex items-center gap-2 bg-white text-violet-700 font-bold text-sm px-4 py-2 rounded-xl hover:bg-violet-50 transition-colors shadow-sm"
                            >
                                <Plus className="w-4 h-4" />
                                Nueva Campaña
                            </button>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={() => setShowNewCampaignModal(true)}
                                className="hidden sm:flex items-center gap-2 bg-white text-violet-700 font-bold text-sm px-4 py-2.5 rounded-xl hover:bg-violet-50 transition-colors shadow-sm"
                            >
                                <Plus className="w-4 h-4" />
                                Nueva Campaña
                            </button>
                            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white/15 rounded-xl sm:rounded-2xl flex items-center justify-center">
                                <Megaphone className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Campaign Credits Card */}
            <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden">
                <div className="bg-gradient-to-br from-violet-500 to-violet-700 p-4 text-white flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 bg-white/15 rounded-xl flex items-center justify-center shrink-0">
                            <Coins className="w-5 h-5 text-white" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-xs font-black uppercase tracking-widest text-violet-200 truncate">Créditos de Campaña</p>
                            <p className="text-xl sm:text-2xl font-extrabold leading-tight">{campaignCredits.toLocaleString('es-CL')} <span className="text-sm sm:text-base font-medium text-violet-200">disp.</span></p>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowBuyCredits(v => !v)}
                        className="flex items-center gap-1.5 bg-white text-violet-700 font-bold text-sm px-3 py-2 rounded-xl hover:bg-violet-50 transition-colors shrink-0"
                    >
                        <ShoppingCart className="w-4 h-4" />
                        <span className="hidden sm:inline">Comprar créditos</span>
                        <span className="sm:hidden">Comprar</span>
                    </button>
                </div>

                {showBuyCredits && (
                    <div className="p-5 border-t border-silk-beige">
                        <p className="text-xs text-charcoal/50 mb-3">
                            <strong className="text-charcoal">US$0.15 por crédito · 1 crédito = 1 mensaje · Sin vencimiento</strong>
                        </p>
                        <div className="flex flex-col gap-3">
                            <div className="flex items-center gap-2 flex-wrap">
                                <div className="flex items-center gap-2 bg-ivory border border-silk-beige rounded-xl px-3 py-2">
                                    <button
                                        onClick={() => setBuyCreditsQty(q => Math.max(50, q - 50))}
                                        className="w-7 h-7 rounded-lg bg-silk-beige hover:bg-violet-100 text-charcoal font-bold flex items-center justify-center transition-colors"
                                    >−</button>
                                    <input
                                        type="number"
                                        min={50}
                                        step={50}
                                        value={buyCreditsQty}
                                        onChange={e => setBuyCreditsQty(Math.max(50, parseInt(e.target.value) || 50))}
                                        className="w-16 text-center bg-transparent font-bold text-charcoal text-lg focus:outline-none"
                                    />
                                    <button
                                        onClick={() => setBuyCreditsQty(q => q + 50)}
                                        className="w-7 h-7 rounded-lg bg-silk-beige hover:bg-violet-100 text-charcoal font-bold flex items-center justify-center transition-colors"
                                    >+</button>
                                </div>
                                <div className="flex gap-2">
                                    {[100, 300, 500].map(preset => (
                                        <button
                                            key={preset}
                                            onClick={() => setBuyCreditsQty(preset)}
                                            className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors ${buyCreditsQty === preset ? 'bg-violet-100 border-violet-300 text-violet-700' : 'bg-white border-silk-beige text-charcoal/60 hover:border-violet-200'}`}
                                        >{preset}</button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-lg font-extrabold text-charcoal">
                                    US${(buyCreditsQty * CREDIT_PRICE_USD).toFixed(2)}
                                </span>
                                <button
                                    onClick={handleBuyCredits}
                                    disabled={buyingCredits}
                                    className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-bold px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50"
                                >
                                    {buyingCredits ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
                                    Comprar {buyCreditsQty} créditos
                                </button>
                            </div>
                        </div>
                        <p className="text-xs text-charcoal/40 mt-3">Mínimo 50 créditos por compra. Los créditos no vencen.</p>
                    </div>
                )}
            </div>

            <GuideBox title="Campañas de WhatsApp Masivas" summary="Automatiza el re-contacto usando etiquetas segmentadas.">
                <div className="space-y-4">
                    <p>Las campañas te permiten notificar promociones, descuentos o avisos importantes a un gran grupo de pacientes a la vez en base a etiquetas.</p>
                    <ul className="list-disc pl-5 space-y-2">
                        <li><strong>Segmentación Efectiva:</strong> Usa etiquetas de "INCLUSIÓN" para enviar mensajes solo a un target específico (Ej: Perros, Gatos, Frecuente).</li>
                        <li><strong>Exclusión Segura:</strong> Añade etiquetas de "EXCLUSIÓN" para evitar spammear a pacientes morosos o recientes (Ej: Deudor, Cita reciente).</li>
                        <li><strong>Estimador de Audiencia:</strong> Verás automáticamente a cuántos pacientes contactarás antes de lanzar la campaña.</li>
                    </ul>
                </div>
            </GuideBox>

            {/* Campaign List */}
            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
                </div>
            ) : campaigns.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-soft border border-silk-beige">
                    <Megaphone className="w-12 h-12 text-charcoal/20 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-charcoal">No hay campañas</h3>
                    <p className="text-charcoal/50 max-w-sm mx-auto mt-2">
                        Crea tu primera campaña para contactar a tus pacientes y aumentar tus ventas.
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {campaigns.map(campaign => (
                        <div key={campaign.id} className="bg-white p-5 rounded-soft border border-silk-beige hover:shadow-soft-lg transition-shadow">
                            <div className="flex justify-between items-start mb-4">
                                <div className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(campaign.status)}`}>
                                    {getStatusLabel(campaign.status)}
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="text-xs text-charcoal/40">
                                        {new Date(campaign.created_at).toLocaleDateString()}
                                    </div>
                                    <button
                                        onClick={() => handleDeleteCampaign(campaign.id)}
                                        className="text-charcoal/40 hover:text-red-500 transition-colors"
                                        title="Eliminar campaña"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            <h3 className="font-semibold text-charcoal text-lg mb-1">{campaign.name}</h3>
                            <p className="text-sm text-charcoal/60 mb-4 flex items-center gap-2">
                                <FileText className="w-3 h-3" />
                                {templates.find(t => t.id === campaign.template_name)?.name || campaign.template_name}
                            </p>

                            <div className="flex items-center gap-4 text-sm text-charcoal/70 mb-6 bg-ivory p-3 rounded-soft">
                                <div className="flex items-center gap-1.5 tooltipped" title="Audiencia Objetivo">
                                    <Users className="w-4 h-4 text-primary-500" />
                                    <span>{campaign.total_target}</span>
                                </div>
                                <div className="flex items-center gap-1.5 tooltipped" title="Enviados">
                                    <Send className="w-4 h-4 text-emerald-500" />
                                    <span>{campaign.sent_count}</span>
                                </div>
                                {/* Could add open rate if we had read receipts */}
                            </div>

                            <div className="flex gap-2">
                                {campaign.status === 'draft' && (
                                    <>
                                        {campaign.total_target > campaignCredits && (
                                            <div className="w-full flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-1">
                                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                                Necesitas {campaign.total_target} créditos (tienes {campaignCredits})
                                            </div>
                                        )}
                                        <button
                                            onClick={() => handleLaunchCampaign(campaign.id)}
                                            disabled={campaign.total_target > campaignCredits}
                                            className="w-full btn-primary py-2 text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <Send className="w-4 h-4" />
                                            Lanzar Ahora
                                        </button>
                                    </>
                                )}
                                {campaign.status !== 'draft' && (
                                    <button className="w-full btn-ghost py-2 text-sm border border-silk-beige" disabled>
                                        <BarChart3 className="w-4 h-4 mr-2" />
                                        Ver Reporte
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* New Campaign Modal */}
            {showNewCampaignModal && (
                <div className="fixed inset-0 bg-charcoal/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white w-full max-w-lg rounded-soft shadow-soft-xl border border-silk-beige flex flex-col max-h-[90vh]">
                        <div className="flex items-center justify-between p-5 border-b border-silk-beige">
                            <h3 className="text-lg font-semibold text-charcoal">Nueva Campaña</h3>
                            <button onClick={() => setShowNewCampaignModal(false)} className="p-2 hover:bg-silk-beige rounded-soft transition-colors">
                                <X className="w-5 h-5 text-charcoal/60" />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto">
                            {/* Steps Indicator */}
                            <div className="flex items-center gap-2 mb-8 text-sm">
                                <div className={`flex items-center gap-2 ${step >= 1 ? 'text-violet-600 font-medium' : 'text-charcoal/40'}`}>
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center ${step >= 1 ? 'bg-violet-100' : 'bg-silk-beige'}`}>1</div>
                                    Detalles
                                </div>
                                <div className="h-px w-8 bg-silk-beige" />
                                <div className={`flex items-center gap-2 ${step >= 2 ? 'text-primary-600 font-medium' : 'text-charcoal/40'}`}>
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center ${step >= 2 ? 'bg-primary-100' : 'bg-silk-beige'}`}>2</div>
                                    Contenido
                                </div>
                            </div>

                            {step === 1 && (
                                    <div className="space-y-4">
                                        <div>
                                            <label className="label text-xs uppercase tracking-wider text-charcoal/40 font-bold mb-2 block">Nombre de la Campaña</label>
                                            <input
                                                type="text"
                                                className="input w-full"
                                                placeholder="Ej: Promo Verano 2024"
                                                value={newCampaignName}
                                                onChange={(e) => setNewCampaignName(e.target.value)}
                                            />
                                        </div>

                                        <div className="grid grid-cols-1 gap-4">
                                            <div>
                                                <label className="label text-xs uppercase tracking-wider text-charcoal/40 font-bold mb-2 block">Incluir etiquetas (Y)</label>
                                                <div className="flex flex-wrap gap-2 p-3 bg-ivory rounded-soft border border-silk-beige min-h-[44px]">
                                                    {tags.map(tag => (
                                                        <button
                                                            key={`inc-${tag.id}`}
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                if (inclusionTags.includes(tag.id)) {
                                                                    setInclusionTags(prev => prev.filter(id => id !== tag.id))
                                                                } else {
                                                                    setInclusionTags(prev => [...prev, tag.id])
                                                                    setExclusionTags(prev => prev.filter(id => id !== tag.id))
                                                                }
                                                            }}
                                                            className={`
                                                                px-2 py-1 rounded text-xs font-bold font-bold uppercase tracking-wider border transition-all
                                                                ${inclusionTags.includes(tag.id)
                                                                    ? 'bg-violet-500 text-white border-violet-600 shadow-sm'
                                                                    : 'bg-white text-charcoal/40 border-silk-beige hover:border-violet-300'
                                                                }
                                                            `}
                                                        >
                                                            {tag.name}
                                                        </button>
                                                    ))}
                                                    {tags.length === 0 && <span className="text-xs text-charcoal/30">No hay etiquetas creadas</span>}
                                                </div>
                                            </div>

                                            <div>
                                                <label className="label text-xs uppercase tracking-wider text-charcoal/40 font-bold mb-2 block text-red-600">Excluir etiquetas (NO)</label>
                                                <div className="flex flex-wrap gap-2 p-3 bg-red-50/30 rounded-soft border border-red-100 min-h-[44px]">
                                                    {tags.map(tag => (
                                                        <button
                                                            key={`exc-${tag.id}`}
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                if (exclusionTags.includes(tag.id)) {
                                                                    setExclusionTags(prev => prev.filter(id => id !== tag.id))
                                                                } else {
                                                                    setExclusionTags(prev => [...prev, tag.id])
                                                                    setInclusionTags(prev => prev.filter(id => id !== tag.id))
                                                                }
                                                            }}
                                                            className={`
                                                                px-2 py-1 rounded text-xs font-bold font-bold uppercase tracking-wider border transition-all
                                                                ${exclusionTags.includes(tag.id)
                                                                    ? 'bg-red-500 text-white border-red-600 shadow-sm'
                                                                    : 'bg-white text-charcoal/40 border-silk-beige hover:border-red-300'
                                                                }
                                                            `}
                                                        >
                                                            {tag.name}
                                                        </button>
                                                    ))}
                                                    {tags.length === 0 && <span className="text-xs text-charcoal/30">No hay etiquetas creadas</span>}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="bg-violet-50 text-violet-700 px-4 py-3 rounded-soft text-sm flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Users className="w-4 h-4" />
                                                <span>Público estimado:</span>
                                            </div>
                                            <strong className="text-lg">
                                                {estimatedAudience !== null ? `${estimatedAudience} ${estimatedAudience === 1 ? 'contacto' : 'contactos'}` : '--'}
                                            </strong>
                                        </div>
                                    </div>
                            )}

                            {step === 2 && (
                                <div className="space-y-4">
                                    <label className="label">Plantilla de WhatsApp</label>
                                    <div className="grid grid-cols-1 gap-3 max-h-[300px] overflow-y-auto pr-2">
                                        {templates.length === 0 ? (
                                            <div className="text-sm text-charcoal/50 text-center py-4 bg-ivory rounded-soft border border-dashed">
                                                No hay plantillas aprobadas disponibles.
                                            </div>
                                        ) : (
                                            templates.map(template => (
                                                <div
                                                    key={template.id}
                                                    className={`
                                                        p-3 rounded-soft border cursor-pointer transition-all
                                                        ${selectedTemplate === template.id
                                                            ? 'border-violet-500 bg-violet-50'
                                                            : 'border-silk-beige hover:border-violet-200'
                                                        }
                                                    `}
                                                    onClick={() => setSelectedTemplate(template.id)}
                                                >
                                                    <div className="font-medium text-charcoal truncate">{template.name}</div>
                                                    <div className="text-xs text-charcoal/60 mt-1 line-clamp-2">{template.body || '(Sin cuerpo)'}</div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="p-5 border-t border-silk-beige flex justify-between bg-ivory rounded-b-soft">
                            {step > 1 ? (
                                <button onClick={() => setStep(step - 1)} className="btn-ghost">
                                    Atrás
                                </button>
                            ) : (
                                <div></div>
                            )}

                            {step < 2 ? (
                                <button
                                    onClick={() => setStep(step + 1)}
                                    disabled={!newCampaignName || (inclusionTags.length === 0 && exclusionTags.length === 0)}
                                    className="btn-primary"
                                >
                                    Siguiente
                                </button>
                            ) : (
                                <button
                                    onClick={handleCreateCampaign}
                                    disabled={!selectedTemplate || creating}
                                    className="btn-primary flex items-center gap-2"
                                >
                                    {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Crear Campaña
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
