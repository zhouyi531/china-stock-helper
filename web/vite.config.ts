import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

const SERVER_PORT = process.env.SERVER_PORT || "8787";

function loadServerAuthHeader(): Record<string, string> | undefined {
  const envPath = path.resolve(__dirname, "../server/.env");
  if (!fs.existsSync(envPath)) return undefined;

  const env = Object.fromEntries(
    fs
      .readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1)];
      })
  );

  const password = env.APP_PASSWORD || "";
  if (!password) return undefined;

  const username = env.APP_USERNAME || "admin";
  const token = Buffer.from(`${username}:${password}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

const proxyHeaders = loadServerAuthHeader();

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: ["a-market.smartbytes.jp"],
    proxy: {
      "/api": {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
        headers: proxyHeaders,
      },
      "/ws": {
        target: `ws://localhost:${SERVER_PORT}`,
        ws: true,
        headers: proxyHeaders,
      },
    },
  },
});
