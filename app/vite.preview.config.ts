import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Standalone build of the read-only Quick Look preview page.
//
// `base: "./"` makes all asset URLs relative so the page can be loaded from a
// `file://` URL inside the macOS Quick Look sandbox (where there is no dev
// server / custom protocol). Output is fully self-contained in `dist-preview/`.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist-preview",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "preview.html"),
    },
  },
});
