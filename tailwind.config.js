/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        charcoal: {
          950: '#0F172A',
          900: '#111827',
          850: '#182234',
          800: '#1F2937', // Main background as required
          700: '#374151',
          600: '#4B5563',
        },
        gold: {
          50: '#FCF8ED',
          100: '#F7EDD1',
          200: '#EED9A2',
          300: '#E4C371',
          400: '#DCAE42',
          500: '#D4A017', // Main accent gold as required
          600: '#B8860B',
          700: '#8E6708',
          800: '#644805',
          900: '#3B2A03',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
