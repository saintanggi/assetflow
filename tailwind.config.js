/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Neutral surfaces — putih dominan, latar kerja abu-abu sangat muda
        ink: {
          50: "#F7F8FA", // main background (area kerja)
          100: "#F3F4F6", // subtle fill / hover
          200: "#E5E7EB", // border
          300: "#D1D5DB", // border kuat / disabled
          400: "#9CA3AF", // muted text
          500: "#6B7280", // secondary text
          600: "#4B5563",
          700: "#374151",
          800: "#1F2937", // primary text
          900: "#111827",
          950: "#0B1220",
        },
        // Identitas merek: merah (primer, menu aktif, aksen)
        brand: {
          50: "#FEF2F2", // light red background
          100: "#FEE2E2",
          200: "#FECACA",
          300: "#FCA5A5",
          400: "#F87171",
          500: "#DC2626", // error
          600: "#C62828", // PRIMARY RED
          700: "#B71C1C", // hover red
          800: "#991B1B", // deep red
          900: "#7F1D1D",
        },
        // Warna status fungsional (hanya untuk makna, bukan dekorasi)
        ok: {
          50: "#F0FDF4",
          100: "#DCFCE7",
          500: "#16A34A",
          600: "#15803D",
          700: "#166534",
        },
        warn: {
          50: "#FFFBEB",
          100: "#FEF3C7",
          500: "#F59E0B",
          600: "#D97706",
          700: "#B45309",
        },
        info: {
          50: "#EFF6FF",
          100: "#DBEAFE",
          500: "#3B82F6",
          600: "#2563EB",
          700: "#1D4ED8",
        },
        navy: {
          50: "#EFF6FF",
          100: "#DBEAFE",
          200: "#BFDBFE",
          300: "#93C5FD",
          400: "#60A5FA",
          500: "#3B82F6",
          600: "#2563EB",
          700: "#1D4ED8",
          800: "#1E40AF",
          900: "#1E3A8A",
          950: "#172554",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Plus Jakarta Sans", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.04), 0 4px 16px rgba(16, 24, 40, 0.06)",
        soft: "0 1px 3px rgba(16, 24, 40, 0.08)",
        pop: "0 8px 28px rgba(16, 24, 40, 0.12)",
        glow: "0 4px 14px rgba(198, 40, 40, 0.22)",
      },
      borderRadius: {
        xl: "0.75rem", // 12px — kartu
        "2xl": "1rem", // 16px — panel besar
      },
    },
  },
  plugins: [],
};
