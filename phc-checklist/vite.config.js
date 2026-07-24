import { defineConfig } from "vite";
import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  plugins: [{
    name: "copy-phc-pwa-files",
    closeBundle(){
      mkdirSync(resolve("dist/assets"),{recursive:true});
      cpSync(resolve("assets"),resolve("dist/assets"),{recursive:true});
      copyFileSync(resolve("sw.js"),resolve("dist/sw.js"));
    }
  }],
  build: {
    rollupOptions: {
      input: {
        dashboard: "index.html",
        inspection: "inspection.html",
        records: "records.html",
        settings: "settings.html"
      }
    }
  }
});
