/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f4ff',
          100: '#e0e9ff',
          500: '#3b6fd4',
          600: '#2d5bbf',
          700: '#1e4aa8',
          900: '#0f2d6b',
        },
        dark: {
          900: '#0a0e1a',
          800: '#0d1224',
          700: '#111827',
          600: '#1a2235',
          500: '#1e2a40',
          400: '#243050',
          300: '#2d3a5c',
        },
        up: '#f5222d',
        down: '#52c41a',
        flat: '#8c8c8c',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
