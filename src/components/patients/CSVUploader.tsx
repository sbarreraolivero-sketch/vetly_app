import { useState, useRef } from 'react'
import { Upload, FileSpreadsheet, X, CheckCircle2, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Database } from '@/types/database'

interface CSVUploaderProps {
    onSuccess: () => void;
}

export function CSVUploader({ onSuccess }: CSVUploaderProps) {
    const { profile } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
            setError('Por favor sube un archivo CSV válido.');
            return;
        }

        setError(null);
        setSuccessMessage(null);
        setIsUploading(true);

        try {
            const text = await file.text();

            // Basic CSV parsing (comma or semicolon separated)
            const rows = text.split('\n').map(row => row.trim()).filter(row => row.length > 0);

            if (rows.length < 2) {
                throw new Error('El archivo está vacío o no tiene el formato correcto.');
            }

            const header = rows[0].toLowerCase();
            const delimiter = header.includes(';') ? ';' : ',';
            const headers = header.split(delimiter).map(h => h.trim());

            // Find necessary column indexes
            const phoneIdx = headers.findIndex(h => h.includes('tel') || h.includes('cel') || h.includes('phone') || h.includes('cont'));
            const nameIdx = headers.findIndex(h => h.includes('nom') || h.includes('paciente') || h.includes('mascota') || h.includes('name'));

            if (phoneIdx === -1) {
                throw new Error('No se encontró una columna válida para los números de Teléfono.');
            }

            const formatPhoneNumber = (phone: string) => {
                let formatted = phone.replace(/\D/g, ''); // leave only numbers
                if (!formatted) return null;
                if (!formatted.startsWith('569') && !formatted.startsWith('52') && !formatted.startsWith('57')) {
                    // Default assume Chile if completely unknown, though ideally user should provide correct 
                    if (formatted.length === 8) formatted = '569' + formatted;
                    else if (formatted.length === 9) formatted = '56' + formatted;
                }
                return `+${formatted}`;
            };

            const patientsToAdd: Database['public']['Tables']['patients']['Insert'][] = [];
            let validCount = 0;
            let invalidCount = 0;

            for (let i = 1; i < rows.length; i++) {
                const rowObj = rows[i].split(delimiter).map(c => c.trim());
                if (rowObj.length === 0) continue;

                const rawPhone = phoneIdx !== -1 ? rowObj[phoneIdx] : '';
                const formattedPhone = rawPhone ? formatPhoneNumber(rawPhone) : null;

                // For now, we'll only add patients. In a real scenario, 
                // we'd create a tutor first and then link it.
                // To fix the build error, we use fields that EXIST in the patients table
                patientsToAdd.push({
                    clinic_id: profile?.clinic_id,
                    name: nameIdx !== -1 ? (rowObj[nameIdx] || 'Sin Nombre') : 'Sin Nombre',
                    species: 'Canino', // Default or could be parsed
                    notes: formattedPhone ? `Teléfono importado: ${formattedPhone}` : null
                });
                validCount++;
            }

            if (patientsToAdd.length === 0) {
                throw new Error('No se pudo encontrar ningún paciente válido en el archivo.');
            }

            const { error: insertError } = await (supabase.from('patients') as any)
                .insert(patientsToAdd);

            if (insertError) throw insertError;

            setSuccessMessage(`Se importaron ${validCount} pacientes exitosamente. (${invalidCount} filas ignoradas)`);
            onSuccess();

            setTimeout(() => {
                setIsOpen(false);
                setSuccessMessage(null);
            }, 3000);

        } catch (err: any) {
            console.error('CSV Upload Error:', err);
            setError(err.message || 'Error desconocido al subir el archivo');
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };


    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="btn-ghost flex items-center gap-2 self-start sm:self-auto bg-white border border-silk-beige"
            >
                <Upload className="w-4 h-4 text-primary-500" />
                Importar CSV
            </button>

            {isOpen && (
                <div className="fixed inset-0 bg-charcoal/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-scale-in">
                        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                            <div>
                                <h3 className="text-xl font-bold text-charcoal flex items-center gap-2">
                                    <FileSpreadsheet className="w-5 h-5 text-primary-500" />
                                    Importar Pacientes
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">Sube un Excel exportado como CSV.</p>
                            </div>

                            <button
                                onClick={() => !isUploading && setIsOpen(false)}
                                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                            >
                                <X className="w-5 h-5 text-gray-400" />
                            </button>
                        </div>

                        <div className="p-6 space-y-6">

                            {error && (
                                <div className="bg-red-50 text-red-700 p-4 rounded-xl text-sm flex items-start gap-3">
                                    <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                                    <p>{error}</p>
                                </div>
                            )}

                            {successMessage && (
                                <div className="bg-emerald-50 text-emerald-700 p-4 rounded-xl text-sm flex items-start gap-3">
                                    <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
                                    <p className="font-bold">{successMessage}</p>
                                </div>
                            )}

                            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 border-dashed text-sm">
                                <p className="font-bold mb-2">Reglas del archivo:</p>
                                <ul className="list-disc list-inside space-y-1 text-gray-600">
                                    <li>Debe tener una columna llamada "Teléfono"</li>
                                    <li>Recomendado: "Nombre" y "Fecha"</li>
                                    <li>Formato CSV delimitado por comas (,) o punto y coma (;)</li>
                                </ul>
                            </div>

                            <div className="flex justify-center">
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    accept=".csv,text/csv"
                                    onChange={handleFileUpload}
                                    className="hidden"
                                    id="csv-upload"
                                    disabled={isUploading}
                                />
                                <label
                                    htmlFor="csv-upload"
                                    className={`w-full py-4 border-2 border-dashed border-primary-200 rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-all hover:bg-primary-50 ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    {isUploading ? (
                                        <>
                                            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
                                            <span className="text-primary-600 font-bold">Procesando...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Upload className="w-6 h-6 text-primary-400" />
                                            <span className="text-charcoal font-medium">Click para seleccionar archivo</span>
                                        </>
                                    )}
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
