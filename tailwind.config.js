/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Command-center dark surfaces
        ink: {
          950: "#0a0e14", // page background
          900: "#0f1520", // raised surface
          850: "#131a28", // cards
          800: "#1a2233", // hover / strong borders
          700: "#26314a", // borders
        },
        // Brand accent: teal (primary actions, highlights)
        brand: {
          50: "#f0fdfa",
          100: "#ccfbf1",
          200: "#99f6e4",
          300: "#5eead4",
          400: "#2dd4bf",
          500: "#14b8a6",
          600: "#0d9488",
          700: "#0f766e",
          800: "#115e59",
          900: "#134e4a",
        },
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
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Plus Jakarta Sans", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        glow: "0 0 24px rgba(45, 212, 191, 0.15)",
        card: "0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.25)",
      },
    },
  },
  plugins: [],
};
