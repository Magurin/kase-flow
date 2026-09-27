import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: ["**/.local/**", "**/artifacts/**", "**/program/target/**"],
    },
    port: Number(process.env.VITE_PORT || 5173),
    strictPort: true,
    proxy: { "/api": `http://127.0.0.1:${process.env.API_PORT || 3001}` },
  },
});
