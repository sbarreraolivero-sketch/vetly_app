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
                // Soft Luxury Palette
                ivory: '#FAFAF8',
                'silk-beige': '#EDE6DE',
                charcoal: '#2E2E2E',
                'gold-soft': '#C8A96A',
                champagne: '#E6D3A3',

                // Primary - Verde Clínico
                primary: {
                    50: '#E8F5F1',
                    100: '#D1EBE3',
                    200: '#A3D7C7',
                    300: '#75C3AB',
                    400: '#47AF8F',
                    500: '#1F6F5C',
                    600: '#1A5C4D',
                    700: '#15493E',
                    800: '#10362F',
                    900: '#0B2F29',
                    950: '#061A17',
                },

                // Accent - Oro/Champagne
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
                sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
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
                'hero-gradient': 'linear-gradient(135deg, #1F6F5C 0%, #7FA89A 100%)',
                'premium-gradient': 'linear-gradient(135deg, #C8A96A 0%, #E6D3A3 100%)',
                'subtle-gradient': 'linear-gradient(180deg, #FAFAF8 0%, #EDE6DE 100%)',
            },
            boxShadow: {
                'soft': '0 2px 8px rgba(46, 46, 46, 0.06)',
                'soft-md': '0 4px 16px rgba(46, 46, 46, 0.08)',
                'soft-lg': '0 8px 32px rgba(46, 46, 46, 0.10)',
                'soft-xl': '0 16px 48px rgba(46, 46, 46, 0.12)',
                'glow-gold': '0 0 24px rgba(200, 169, 106, 0.3)',
                'glow-primary': '0 0 24px rgba(31, 111, 92, 0.2)',
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
