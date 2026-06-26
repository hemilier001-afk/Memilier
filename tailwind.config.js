/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 语义化色板，由 index.css 的 CSS 变量驱动（深浅主题切换）
        // 暖中性底 + 珊瑚橙强调色
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          soft: 'var(--accent-soft)'
        },
        paper: 'var(--paper)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        line: 'var(--line)',
        fg: 'var(--fg)',
        muted: 'var(--muted)'
      }
    }
  },
  plugins: []
}
