import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/qa-artifacts/**", "**/release/**"] } },
  // Rust embeds copies of index.html in target/. They are build outputs, not
  // frontend entries; scanning them can stall cold dev and browser QA startup.
  optimizeDeps: { entries: ["index.html", "qa.html", "qa-app.html"] },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: { target: "es2021", sourcemap: true },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"], globals: true }
});
