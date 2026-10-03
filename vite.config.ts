import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs: the site is served under /find/ today and must keep
  // working unchanged if it ever moves to its own domain.
  base: "./",
  plugins: [react(), tailwindcss()],
  // The prerender bundle renders FiestaUI components in Node.
  ssr: { noExternal: ["@fiestaboard/ui"] },
  build: {
    // The page's CSP allows scripts and styles only from 'self', so nothing
    // may be inlined: no data: URIs, no injected inline polyfill.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    emptyOutDir: true,
  },
});
