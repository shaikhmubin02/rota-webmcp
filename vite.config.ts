import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // GitHub Pages serves the app from a repository subpath, Vercel and Netlify
  // from the root. Set VITE_BASE at build time for the former.
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), tailwindcss()],
  build: { target: "es2022", sourcemap: true },
});
