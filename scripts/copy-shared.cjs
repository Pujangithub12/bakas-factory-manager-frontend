// The business rules and time helpers are written once, in mobile/src, and copied here.
// Edit them there. This runs automatically before dev and build.
const fs = require("fs");
const path = require("path");
// Sibling checkout of the mobile app: "mobile" in the monorepo layout, or the cloned repo name.
// Override with MOBILE_SRC=<path to mobile/src>.
const candidates = [
  process.env.MOBILE_SRC,
  path.join(__dirname, "..", "..", "mobile", "src"),
  path.join(__dirname, "..", "..", "bakas-factory-manager-mobile", "src"),
].filter(Boolean);
const from = candidates.find((d) => fs.existsSync(path.join(d, "rules.ts")));
if (!from) {
  console.error(
    "Could not find the mobile app's src/rules.ts. Looked in:\n  " +
      candidates.join("\n  ") +
      "\nClone bakas-factory-manager-mobile next to this folder or set MOBILE_SRC.",
  );
  process.exit(1);
}
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