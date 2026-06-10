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
        // vivid alarm red for active exit warnings (distinct from up/down semantics)
        alarm: "#ff3b30",
        panel: "#0f1620",
        panelraised: "#16202c",
        edge: "#243140",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [typography],
};
