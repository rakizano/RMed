import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // RMed is deployed at /RMed/ on GitHub Pages.
  base: "/RMed/",
  plugins: [react()],
});
