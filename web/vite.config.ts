import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const SERVER_PORT = process.env.SERVER_PORT || "8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
      },
      "/ws": {
        target: `ws://localhost:${SERVER_PORT}`,
        ws: true,
      },
    },
  },
});
