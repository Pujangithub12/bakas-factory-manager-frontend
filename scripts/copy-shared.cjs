// The business rules and time helpers are written once, in mobile/src, and copied here.
// Edit them there. This runs automatically before dev and build.
const fs = require("fs");
const path = require("path");
const from = path.join(__dirname, "..", "..", "mobile", "src");
const to = path.join(__dirname, "..", "src", "shared");
fs.mkdirSync(to, { recursive: true });
const banner = "// COPIED from mobile/src by scripts/copy-shared.cjs. Do not edit here.\n";
for (const f of ["rules.ts", "time.ts"]) {
  let t = fs.readFileSync(path.join(from, f), "utf8");
  t = t.replace('from "./store"', 'from "./types"');
  fs.writeFileSync(path.join(to, f), banner + t);
}
fs.writeFileSync(path.join(to, "types.ts"), banner + 'import type { Row } from "./time";\nexport type Data = Record<string, Row[]>;\n');
console.log("shared rules copied");