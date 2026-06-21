import esbuild from "esbuild";
import process from "process";
import fs from "fs";
import path from "path";

const prod = (process.argv[2] === "production");

const vaultPluginDir = path.resolve("../../.obsidian/plugins/loom");

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  platform: "node",
  target: "es2021",
  sourcemap: prod ? false : "inline",
  minify: prod,
  legalComments: "none",
  external: [
    "obsidian",
    "electron",
    "@codemirror/state",
    "@codemirror/view",
    "@codemirror/language",
  ],
  logLevel: "info",
});

// Copy output to the vault plugins directory
try {
  if (!fs.existsSync(vaultPluginDir)) {
    fs.mkdirSync(vaultPluginDir, { recursive: true });
  }
  fs.copyFileSync("main.js", path.join(vaultPluginDir, "main.js"));
  fs.copyFileSync("manifest.json", path.join(vaultPluginDir, "manifest.json"));
  if (fs.existsSync("styles.css")) {
    fs.copyFileSync("styles.css", path.join(vaultPluginDir, "styles.css"));
  }
  console.log("Deployed build to Obsidian vault!");
} catch (err) {
  console.error("Failed to copy built files to vault:", err);
}
