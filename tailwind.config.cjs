module.exports = {
  darkMode: 'class',
  content: ['./renderer/index.html', './renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      borderRadius: {
        '2xl': '1rem'
      },
      boxShadow: {
        soft: '0 8px 30px rgba(8, 20, 45, 0.12)'
      },
      fontFamily: {
        sans: ['Manrope', 'Segoe UI', 'sans-serif']
      },
      colors: {
        brand: {
          50: '#f0f8ff',
          100: '#d9edff',
          200: '#b7dbff',
          300: '#84c2ff',
          400: '#4aa0ff',
          500: '#2484eb',
          600: '#1768c0',
          700: '#14549b',
          800: '#16477f',
          900: '#183e69'
        }
      },
      keyframes: {
        pulseRing: {
          '0%': { boxShadow: '0 0 0 0 rgba(36, 132, 235, 0.6)' },
          '70%': { boxShadow: '0 0 0 12px rgba(36, 132, 235, 0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(36, 132, 235, 0)' }
        }
      },
      animation: {
        pulseRing: 'pulseRing 1.8s infinite'
      }
    }
  },
  plugins: []
};
