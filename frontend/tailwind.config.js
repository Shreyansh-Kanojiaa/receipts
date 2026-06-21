/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        beige: '#f5f0e8',
        rust:  '#c4622d',
      },
      fontFamily: {
        serif: ['"DM Serif Display"', 'Georgia', 'serif'],
        mono:  ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
}

