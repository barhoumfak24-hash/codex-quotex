/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Cormorant Garamond'", "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        ink: {
          50: "#f7f7f6",
          100: "#e9e8e3",
          200: "#cfccc1",
          300: "#a8a394",
          400: "#7d7868",
          500: "#5a5547",
          600: "#3f3b30",
          700: "#2a271f",
          800: "#1b1913",
          900: "#0d0c09",
        },
        gold: {
          50: "#fbf8ef",
          100: "#f3ead0",
          200: "#e7d5a1",
          300: "#d6ba6c",
          400: "#c4a04a",
          500: "#a98532",
          600: "#876826",
          700: "#5f4a1c",
        },
        // Unified alert palette. Replaces the ad-hoc rose-500
        // sprinkled across cards, banners, and badges so the whole
        // platform reads as one alerting system. Use:
        //   bg-alert         → the badge fill / dot fill
        //   text-alert       → glyph + emphasized inline text
        //   bg-alert-soft    → banner / row tint background
        //   border-alert-ring → banner border
        alert: {
          DEFAULT: "#E63946",
          soft: "#FDECEE",
          ring: "#F8C2C7",
        },
      },
      boxShadow: {
        luxe: "0 1px 2px rgba(13,12,9,0.04), 0 8px 24px rgba(13,12,9,0.06)",
      },
    },
  },
  plugins: [],
};