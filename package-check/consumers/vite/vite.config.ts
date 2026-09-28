import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// A strict host: no inline scripts or styles anywhere on the page.
const strictCsp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export default defineConfig({
  plugins: [react()],
  preview: { headers: { "Content-Security-Policy": strictCsp } },
});
