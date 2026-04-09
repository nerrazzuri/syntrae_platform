/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        ink: '#211922',
        mist: '#F6F6F3',
        accent: '#E60023',
        accentDark: '#9E0A0A',
        sand: '#E5E5E0',
        olive: '#62625B',
        warm: '#91918C',
        focusBlue: '#435EE5',
      },
      fontFamily: {
        display: ['"Pin Sans"', '"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui'],
        body: ['"Pin Sans"', '"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui'],
      },
      boxShadow: {
        soft: '0 10px 30px -24px rgba(33, 25, 34, 0.25)',
        glow: '0 0 0 1px rgba(33, 25, 34, 0.08)',
      },
    },
  },
  plugins: [],
};
