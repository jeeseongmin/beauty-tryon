import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Plugin to redirect /beauty → /beauty/
function beautyRedirect(): Plugin {
  return {
    name: "beauty-redirect",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === "/beauty") {
          req.url = "/beauty/";
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), beautyRedirect()],
  base: "/beauty/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    proxy: {
      "/beauty/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
