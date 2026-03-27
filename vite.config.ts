import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Plugin: redirect /beauty → /beauty/ and SPA fallback for /beauty/* routes
function beautySpa(): Plugin {
  return {
    name: "beauty-spa",
    configureServer(server) {
      // Pre-middleware: root redirect + /beauty → /beauty/
      server.middlewares.use((req, res, next) => {
        if (req.url === "/" || req.url === "") {
          res.writeHead(302, { Location: "/beauty/" });
          res.end();
          return;
        }
        if (req.url === "/beauty") {
          req.url = "/beauty/";
        }
        next();
      });

      // Returning a function installs it AFTER Vite's internal middlewares
      // but BEFORE the error handler — this is the SPA fallback slot.
      return () => {
        server.middlewares.use(async (req, res, next) => {
          const url = (req as any).originalUrl || req.url || "";
          // Only handle /beauty/* HTML requests, skip API & assets
          if (
            !url.startsWith("/beauty") ||
            url.startsWith("/beauty/api") ||
            url.match(/\.\w+$/) // skip files with extensions (assets)
          ) {
            return next();
          }
          try {
            const { readFileSync } = await import("fs");
            const { join } = await import("path");
            const html = readFileSync(
              join(process.cwd(), "index.html"),
              "utf-8",
            );
            const transformed = await server.transformIndexHtml(url, html);
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html");
            res.end(transformed);
          } catch (e) {
            next(e);
          }
        });
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), beautySpa()],
  base: "/beauty/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
