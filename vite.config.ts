import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": { target: "http://localhost:8788", changeOrigin: true },
    },
    // The API process persists rolling history into .data/ inside this root;
    // ignore it so those writes don't trigger dev-server full reloads.
    watch: {
      ignored: ["**/.data/**"],
    },
  },
})
