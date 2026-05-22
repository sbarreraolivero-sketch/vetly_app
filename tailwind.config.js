/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ["class"],
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // Modern Neutral Palette
                ivory: '#fafafa',
                'silk-beige': '#e4e4e7',
                charcoal: '#18181b',
                'gold-soft': '#C8A96A',
                champagne: '#E6D3A3',

                // Primary - Teal moderno
                primary: {
                    50: '#f0fdfa',
                    100: '#ccfbf1',
                    200: '#99f6e4',
                    300: '#5eead4',
                    400: '#2dd4bf',
                    500: '#0d9488',
                    600: '#0f766e',
                    700: '#115e59',
                    800: '#0d4a45',
                    900: '#083d39',
                    950: '#042f2e',
                },

                // Accent - Oro/Champagne (se mantiene para momentos premium)
                accent: {
                    50: '#FBF8F0',
                    100: '#F7F1E1',
                    200: '#EFE3C3',
                    300: '#E6D3A3',
                    400: '#D9BE86',
                    500: '#C8A96A',
                    600: '#B8954A',
                    700: '#96783B',
                    800: '#745C2D',
                    900: '#52411F',
                    950: '#302611',
                },

                // Shadcn/ui compatible tokens
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
            },
            fontFamily: {
                sans: ['Outfit', 'system-ui', 'sans-serif'],
            },
            fontSize: {
                'display': ['48px', { lineHeight: '1.1', fontWeight: '700' }],
                'h1': ['48px', { lineHeight: '1.2', fontWeight: '700' }],
                'h2': ['36px', { lineHeight: '1.25', fontWeight: '600' }],
                'h3': ['24px', { lineHeight: '1.3', fontWeight: '600' }],
                'h4': ['20px', { lineHeight: '1.4', fontWeight: '600' }],
                'body': ['16px', { lineHeight: '1.5', fontWeight: '400' }],
                'body-sm': ['14px', { lineHeight: '1.5', fontWeight: '400' }],
                'caption': ['12px', { lineHeight: '1.4', fontWeight: '400' }],
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
                'soft': '12px',
                'softer': '16px',
                'softest': '24px',
            },
            backgroundImage: {
                'hero-gradient': 'linear-gradient(135deg, #0d9488 0%, #0ea5e9 100%)',
                'premium-gradient': 'linear-gradient(135deg, #C8A96A 0%, #E6D3A3 100%)',
                'subtle-gradient': 'linear-gradient(180deg, #fafafa 0%, #e4e4e7 100%)',
            },
            boxShadow: {
                'soft': '0 2px 8px rgba(46, 46, 46, 0.06)',
                'soft-md': '0 4px 16px rgba(46, 46, 46, 0.08)',
                'soft-lg': '0 8px 32px rgba(46, 46, 46, 0.10)',
                'soft-xl': '0 16px 48px rgba(46, 46, 46, 0.12)',
                'glow-gold': '0 0 24px rgba(200, 169, 106, 0.3)',
                'glow-primary': '0 0 24px rgba(13, 148, 136, 0.25)',
            },
            animation: {
                'fade-in': 'fadeIn 0.3s ease-out',
                'slide-up': 'slideUp 0.4s ease-out',
                'slide-in-right': 'slideInRight 0.3s ease-out',
                'pulse-soft': 'pulseSoft 2s infinite',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                slideUp: {
                    '0%': { opacity: '0', transform: 'translateY(10px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                slideInRight: {
                    '0%': { opacity: '0', transform: 'translateX(10px)' },
                    '100%': { opacity: '1', transform: 'translateX(0)' },
                },
                pulseSoft: {
                    '0%, 100%': { opacity: '1' },
                    '50%': { opacity: '0.7' },
                },
            },
        },
    },
    plugins: [],
}
