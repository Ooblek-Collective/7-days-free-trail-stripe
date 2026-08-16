import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL("./client", import.meta.url));
const outDir = fileURLToPath(new URL("./public", import.meta.url));

// Backend (server.js) is untouched: this just builds client/index.html and
// client/dashboard.html into public/, which Express already serves as
// static files under those same names.
export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./client/index.html", import.meta.url)),
        dashboard: fileURLToPath(
          new URL("./client/dashboard.html", import.meta.url),
        ),
      },
    },
  },
  server: {
    proxy: {
      "/login": "http://localhost:3000",
      "/register": "http://localhost:3000",
      "/logout": "http://localhost:3000",
      "/subscribe": "http://localhost:3000",
      "/refund": "http://localhost:3000",
      "/api": "http://localhost:3000",
    },
  },
});
