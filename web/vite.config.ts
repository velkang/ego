import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "ego-offline-shell",
      apply: "build",
      enforce: "post",
      generateBundle(_, bundle) {
        const template = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
        const files = Object.keys(bundle).sort();
        if (!files.includes("index.html"))
          this.error("Cannot cache the app shell without index.html");
        const version = createHash("sha256");
        version.update(template);
        for (const file of files) {
          const output = bundle[file];
          version.update(file);
          version.update(output.type === "chunk" ? output.code : output.source);
        }
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: template
            .replace(
              "__BUILD_CACHE__",
              `ego-shell-${version.digest("hex").slice(0, 16)}`,
            )
            .replace(
              "__BUILD_ASSETS__",
              JSON.stringify(files.map((file) =>
                file === "index.html" ? "/" : `/${file}`,
              )),
            ),
        });
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      "/v1": { target: "http://127.0.0.1:8797", changeOrigin: false },
      "/health": "http://127.0.0.1:8797",
    },
  },
});
