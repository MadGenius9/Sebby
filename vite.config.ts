import { defineConfig } from "vite";
export default defineConfig(({ command }) => ({
  base: "./",
  build: { outDir: "dist" },
  server: { host: "127.0.0.1" },
  plugins: [
    {
      name: "development-csp",
      transformIndexHtml(html) {
        return command === "serve"
          ? html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
          : html;
      },
    },
  ],
}));
