/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#EEF2FF',
          100: '#E0E8FF',
          200: '#C2D0FF',
          300: '#94ACFF',
          400: '#6080FF',
          500: '#2E5BFF',
          // primary-600 = --color-brand : single source of truth in index.css :root
          600: '#1A44E8',
          700: '#1230C0',
          800: '#0C1FA0',
          900: '#081480',
        },
        surface: '#F4F6FF',
      },
      borderRadius: {
        '4xl': '28px',
        '5xl': '36px',
      },
      boxShadow: {
        'card':      '0 4px 24px rgba(46, 91, 255, 0.07)',
        'card-lg':   '0 8px 40px rgba(46, 91, 255, 0.12)',
        'blue':      '0 4px 20px rgba(46, 91, 255, 0.40)',
      },
    }
  },
  plugins: []
}
