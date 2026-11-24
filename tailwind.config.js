/** @type {import('tailwindcss').Config} */

// Sage & Sand palette — every shade is a CSS variable so the whole UI
// switches between light and dark via the `dark` class on <html>.
const palette = {
  slate: {
    50: ['F3F0E9', '161D1A'],
    100: ['ECE8DE', '1C2421'],
    200: ['E5E0D8', '2C3833'],
    300: ['CFC8BB', '3C4A44'],
    400: ['A39C8D', '77837C'],
    500: ['7D766A', 'A3B0AA'],
    600: ['635D52', 'BEC9C3'],
    700: ['4E4940', 'D5DCD7'],
    800: ['3B3831', 'E7EAE4'],
    900: ['2F332E', 'F3F1EC'],
  },
  teal: {
    50: ['EEF2EF', '1E2823'],
    100: ['DCE5E0', '24312B'],
    300: ['9DBBAC', '3E574C'],
    400: ['7FA694', '567A6A'],
    500: ['5E8271', '6B9483'],
    600: ['4A6B5D', '6B9483'],
    700: ['3B574B', '82A897'],
  },
  sky: {
    50: ['F7F2EA', '2A241C'],
    100: ['F0E6D6', '332C21'],
    200: ['E3D2B8', '463B2B'],
    300: ['C89F72', '6B5A42'],
    400: ['B58B5E', 'C89F72'],
    500: ['A67B4F', 'D4AE82'],
    600: ['8F6840', 'D4AE82'],
    700: ['745434', 'E0BF97'],
  },
  emerald: {
    50: ['EEF2EF', '1E2823'],
    100: ['DCE5E0', '24312B'],
    200: ['C4D5CB', '2E4038'],
    300: ['A4BFB1', '3E574C'],
    400: ['7FA694', '6B9483'],
    500: ['5E8271', '6B9483'],
    600: ['4A6B5D', '7FA694'],
    700: ['3B574B', '9DBBAC'],
    800: ['2E453B', 'B7CEC1'],
  },
  amber: {
    50: ['F8F2E9', '2A241C'],
    100: ['F1E5D2', '332C21'],
    200: ['E4D0B3', '463B2B'],
    300: ['D1B086', '6B5A42'],
    500: ['C89F72', 'D4AE82'],
    600: ['B58B5E', 'D4AE82'],
    700: ['926F48', 'E6C79E'],
  },
  orange: {
    100: ['F1E5D2', '332C21'],
    600: ['B58B5E', 'D4AE82'],
  },
  indigo: {
    50: ['EEF2EF', '1E2823'],
  },
  rose: {
    50: ['FEF2F2', '2E1F1D'],
    200: ['FECDD3', '4A2F2C'],
    300: ['FDA4AF', '7A524C'],
    500: ['F43F5E', 'D96C5C'],
    600: ['E11D48', 'E07D6D'],
    700: ['BE123C', 'E89587'],
  },
};

const colors = {
  surface: 'rgb(var(--c-surface) / <alpha-value>)',
};

for (const [name, shades] of Object.entries(palette)) {
  colors[name] = {};
  for (const [shade, [light, dark]] of Object.entries(shades)) {
    colors[name][shade] = `rgb(var(--c-${name}-${shade}) / <alpha-value>)`;
    void light;
    void dark;
  }
}

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors,
      // `bg-white` = สีพื้นการ์ด: ขาวใน Light Mode, Dark Sage ใน Dark Mode (ดู --c-card ใน index.css)
      // ส่วน `text-white` ยังเป็นสีขาวจริง เพื่อให้ตัวอักษรบนปุ่มสีเขียว/น้ำตาลอ่านชัดเสมอ
      backgroundColor: { white: 'rgb(var(--c-card) / <alpha-value>)' },
    },
  },
  plugins: [],
};
