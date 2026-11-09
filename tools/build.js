// Genera data/emulator.min.js, data/emulator.min.css y sw.js (lista de archivos para uso sin conexión)
const fs = require("fs");
const path = require("path");
const { minify } = require("terser");
const CleanCSS = require("clean-css");

const SITE = process.argv[2] || path.join(__dirname, "..");
const DATA = path.join(SITE, "data");
// mismo orden que data/loader.js
const scripts = ["emulator.js", "nipplejs.js", "shaders.js", "storage.js", "gamepad.js", "GameManager.js", "socket.io.min.js", "compression.js"];

(async () => {
  const code = {};
  for (const f of scripts) code[f] = fs.readFileSync(path.join(DATA, "src", f), "utf8");
  const out = await minify(code, { compress: { passes: 1 }, mangle: true, format: { comments: false }, ecma: 2020 });
  fs.writeFileSync(path.join(DATA, "emulator.min.js"), out.code);

  const css = new CleanCSS({ level: 1 }).minify(fs.readFileSync(path.join(DATA, "emulator.css"), "utf8"));
  if (css.errors.length) throw new Error(css.errors.join("\n"));
  fs.writeFileSync(path.join(DATA, "emulator.min.css"), css.styles);

  // Archivos que el service worker guarda para funcionar sin conexión
  const files = ["./", "index.html", "app.css", "app.js", "data/loader.js", "data/emulator.min.js", "data/emulator.min.css",
    "data/localization/es-ES.json", "data/localization/en-US.json", "data/localization/retroarch.json"];
  for (const d of ["compression", "cores", "cores/reports"]) {
    for (const f of fs.readdirSync(path.join(DATA, d))) {
      if (fs.statSync(path.join(DATA, d, f)).isFile()) files.push(`data/${d}/${f}`);
    }
  }
  const hash = require("crypto").createHash("sha1");
  for (const f of files.filter(f => f !== "./")) hash.update(fs.readFileSync(path.join(SITE, f)));
  const version = hash.digest("hex").slice(0, 10);
  const tpl = fs.readFileSync(path.join(__dirname, "sw.template.js"), "utf8");
  fs.writeFileSync(path.join(SITE, "sw.js"), tpl.replace("__VERSION__", version).replace("__FILES__", JSON.stringify(files, null, 2)));

  const kb = f => Math.round(fs.statSync(path.join(DATA, f)).size / 1024) + " KB";
  console.log("emulator.min.js", kb("emulator.min.js"), "| emulator.min.css", kb("emulator.min.css"), "| sw version", version, "|", files.length, "files");
})().catch(e => { console.error(e); process.exit(1); });
