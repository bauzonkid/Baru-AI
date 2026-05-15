import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import path from "node:path";

// Electron main process + preload + renderer (React) all built from one config.
// Dev: Vite serves the renderer at localhost:5173 with HMR; vite-plugin-electron
// auto-rebuilds main/preload and restarts the Electron process on changes.
// Build: Vite outputs the renderer to dist/, main+preload to dist-electron/.
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: "main/index.ts",
        vite: {
          build: {
            outDir: "dist-electron/main",
            rollupOptions: {
              // electron + electron-updater stay as runtime requires;
              // Rollup can't (and shouldn't) bundle them.
              external: ["electron", "electron-updater"],
            },
          },
        },
      },
      preload: {
        input: "main/preload.ts",
        vite: {
          build: {
            outDir: "dist-electron/preload",
            rollupOptions: {
              external: ["electron", "electron-updater"],
              output: {
                // Force .cjs extension. vite-plugin-electron defaults
                // to .mjs because the parent package.json has
                // ``"type": "module"`` — but Vite still EMITS CJS
                // (``const electron = require("electron")``) for the
                // preload bundle. Electron 32 strictly enforces
                // module type from extension, so .mjs containing CJS
                // code crashes with "require is not defined in ES
                // module scope" before window.baru can ever be set,
                // making every IPC call from the renderer a silent
                // no-op (button clicks do nothing).
                format: "cjs",
                entryFileNames: "[name].cjs",
              },
            },
          },
        },
      },
      // No renderer-side electron-vite config needed; standard Vite handles it.
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  clearScreen: false,
});
