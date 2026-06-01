import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks: function (id) {
                    // React core — cambia muy raramente, caché de larga duración
                    if (id.includes('node_modules/react/') ||
                        id.includes('node_modules/react-dom/') ||
                        id.includes('node_modules/scheduler/')) {
                        return 'vendor-react';
                    }
                    // React Router
                    if (id.includes('node_modules/react-router') ||
                        id.includes('node_modules/@remix-run/router')) {
                        return 'vendor-router';
                    }
                    // Supabase — agrupa todos los sub-paquetes juntos
                    if (id.includes('node_modules/@supabase/')) {
                        return 'vendor-supabase';
                    }
                    // TanStack Query
                    if (id.includes('node_modules/@tanstack/')) {
                        return 'vendor-query';
                    }
                    // Radix UI + utilidades de UI
                    if (id.includes('node_modules/@radix-ui/') ||
                        id.includes('node_modules/class-variance-authority') ||
                        id.includes('node_modules/clsx') ||
                        id.includes('node_modules/tailwind-merge')) {
                        return 'vendor-ui';
                    }
                    // Recharts (gráficos — solo Dashboard y Finance)
                    if (id.includes('node_modules/recharts') ||
                        id.includes('node_modules/d3-') ||
                        id.includes('node_modules/victory-')) {
                        return 'vendor-charts';
                    }
                    // date-fns (manejo de fechas)
                    if (id.includes('node_modules/date-fns')) {
                        return 'vendor-dates';
                    }
                },
            },
        },
    },
});
