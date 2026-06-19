/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        cocoa: {
          50:  '#fdf6f0',
          100: '#fae8d4',
          200: '#f5cfa3',
          300: '#eead6d',
          400: '#e5863a',
          500: '#dc6419',
          600: '#c24d11',
          700: '#a13911',
          800: '#842e14',
          900: '#6d2713',
        },
      },
    },
  },
  plugins: [],
}
