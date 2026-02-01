import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, "../src");
const outDir = path.resolve(__dirname, "../dist");

for (const file of ["manifest.json", "options.html"]) {
  fs.copyFileSync(path.join(srcDir, file), path.join(outDir, file));
}
