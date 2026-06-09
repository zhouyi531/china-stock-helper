import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // China A-share convention: red = up, green = down
        up: "#ef4444",
        down: "#22c55e",
        panel: "#ffffff",
        panelraised: "#f1f5f9",
        edge: "#e2e8f0",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [typography],
};
