/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Colour tokens are CSS variables (see index.css), so the Black appearance can redefine them.
      // The alpha placeholder keeps opacity modifiers such as bg-herb/25 working.
      colors: {
        ink: 'rgb(var(--ink) / <alpha-value>)',
        paper: 'rgb(var(--paper) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        faint: 'rgb(var(--faint) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        line2: 'rgb(var(--line2) / <alpha-value>)',
        edge: 'rgb(var(--edge) / <alpha-value>)',
        field: 'rgb(var(--field) / <alpha-value>)',
        chip: 'rgb(var(--chip) / <alpha-value>)',
        herb: 'rgb(var(--herb) / <alpha-value>)',
        herbLight: 'rgb(var(--herbLight) / <alpha-value>)',
      },
      fontFamily: {
        display: ['Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
