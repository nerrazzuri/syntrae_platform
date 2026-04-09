/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        ink: '#0F172A',
        mist: '#F8FAFC',
        accent: '#22C55E',
        accentDark: '#16A34A',
        gold: '#F59E0B',
        ocean: '#0F766E',
      },
      fontFamily: {
        display: ['"Sora"', 'ui-sans-serif', 'system-ui'],
        body: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui'],
      },
      boxShadow: {
        soft: '0 20px 50px -30px rgba(15, 23, 42, 0.35)',
        glow: '0 0 0 1px rgba(15, 23, 42, 0.08), 0 20px 45px -25px rgba(15, 23, 42, 0.5)',
      },
    },
  },
  plugins: [],
};
