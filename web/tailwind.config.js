/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0E0E0C',
        paper: '#EDE8DF',
        muted: '#9A948A',
        faint: '#77716A',
        line: '#2A2824',
        line2: '#1F1D1A',
        edge: '#2E2B27',
        field: '#171614',
        chip: '#2A2824',
        herb: '#7DB46C',
        herbLight: '#9CCB8D',
      },
      fontFamily: {
        display: ['Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
