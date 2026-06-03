// PM2 process file for a non-Docker single host (VPS / 云服务器).
//
// One-time setup on the host:
//   npm ci
//   npm run build -w web          # produces web/dist served by the backend
//   cp .env.example server/.env   # then edit secrets (OPENAI_API_KEY, ...)
//
// Run:
//   pm2 start ecosystem.config.cjs
//   pm2 logs a-shares-helper
//   pm2 save && pm2 startup        # keep it alive across reboots
//
// The backend reads secrets from server/.env and serves the web UI on PORT.
module.exports = {
  apps: [
    {
      name: "a-shares-helper",
      cwd: "./server",
      script: "npm",
      args: "run start",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
        TZ: "Asia/Shanghai",
      },
    },
  ],
};
