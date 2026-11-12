/** Token tema G (design.md §Tema G): berry #ad1d8e, pastel pendamping, kartu berbayang, sudut membulat */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#fdf2fa', 100: '#fae1f4', 200: '#f4c3e9', 300: '#ea99d9', 400: '#e05cc4', 500: '#d926b2', 600: '#ad1d8e', 700: '#8e1574', 800: '#6e125a', 900: '#4d0f40', 950: '#2d0b26' },
        n: { 0: '#ffffff', 50: '#faf3f8', 100: '#f6edf3', 200: '#f1e3ec', 300: '#e3cfdc', 400: '#b8a9b4', 500: '#8c7387', 600: '#6b5766', 700: '#4f404b', 800: '#322931', 900: '#2d0b26' },
        page: '#fcf8fb', rail: '#f8e8f3',
        rose: { bg: '#fae1f4', fg: '#8e1574', solid: '#ad1d8e' },
        butter: { bg: '#fcebc0', fg: '#7a5200', solid: '#f2c766' },
        lilac: { bg: '#e9defa', fg: '#4b33b5', solid: '#8b74d9' },
        mint: { bg: '#d9f1e6', fg: '#14573a', solid: '#5fb38a' },
        success: { DEFAULT: '#1f7a4d', bg: '#d9f1e6', fg: '#14573a' },
        warning: { DEFAULT: '#9a6700', bg: '#fcebc0', fg: '#7a5200' },
        danger: { DEFAULT: '#c4281c', bg: '#fdeceb', fg: '#9b1c13', solid: '#e46a5a' },
        info: { DEFAULT: '#4b33b5', bg: '#e9defa', fg: '#4b33b5' },
      },
      fontFamily: { sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'], display: ['Nunito', '"Plus Jakarta Sans"', 'system-ui', 'sans-serif'] },
      borderRadius: { control: '14px', panel: '20px', card: '20px' },
      boxShadow: {
        card: '0 6px 18px rgba(125,40,100,.08)', soft: '0 4px 12px rgba(125,40,100,.10)', chip: '0 2px 8px rgba(125,40,100,.08)',
        brand: '0 8px 18px rgba(173,29,142,.28)', float: '0 24px 60px rgba(45,11,38,.20)', up: '0 -6px 20px rgba(125,40,100,.07)',
      },
    },
  },
  plugins: [],
};
