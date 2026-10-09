/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          50: "#eef3fa",
          100: "#d9e4f2",
          200: "#b3cbe6",
          300: "#84a9d4",
          400: "#5485bf",
          500: "#3467a3",
          600: "#244f85",
          700: "#1a3c68",
          800: "#132c4e",
          900: "#0f2440",
          950: "#0a192e",
        },
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#2f7de1",
          600: "#1f63c4",
          700: "#1a4fa0",
          800: "#1a4384",
          900: "#1a3a6e",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
