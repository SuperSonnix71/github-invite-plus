import * as esbuild from "esbuild";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const srcDir = join(__dirname, "../src");
const outDir = join(__dirname, "../dist");

await esbuild.build({
    entryPoints: [
        join(srcDir, "service_worker.ts"),
        join(srcDir, "content_script.ts"),
        join(srcDir, "options.ts"),
    ],
    bundle: true,
    format: "esm",
    target: "es2022",
    outdir: outDir,
    sourcemap: false,
    minify: true,
    treeShaking: true,
    platform: "browser",
});

console.log("Extension build complete");
