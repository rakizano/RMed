import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages uses /RMed/; Vercel/local serve from the root.
  base: process.env.GITHUB_ACTIONS ? "/RMed/" : "/",
  plugins: [react()],
});
