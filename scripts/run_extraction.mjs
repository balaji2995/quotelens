// Runs the REAL extraction for all demo vendors against a running server and saves the result as the app's starting snapshot.
// Usage: node scripts/run_extraction.mjs [baseUrl] [vendorIds...]
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] || "http://localhost:3000";
const only = process.argv.slice(3);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const rfx = JSON.parse(fs.readFileSync(path.join(root, "src/data/rfx.json")));
const vendors = JSON.parse(fs.readFileSync(path.join(root, "src/data/vendors.json")));
const inbox = JSON.parse(fs.readFileSync(path.join(root, "src/data/inbox.json")));
const snapPath = path.join(root, "src/data/snapshot.json");
const snap = fs.existsSync(snapPath) ? JSON.parse(fs.readFileSync(snapPath)) : { layers: {} };

await Promise.all(inbox.filter((m) => !only.length || only.includes(m.vendor_id)).map(async (m) => {
  const v = vendors.find((x) => x.id === m.vendor_id);
  const files = m.files.map((f) => ({ ...f, base64: fs.readFileSync(path.join(root, "public/demo", f.name)).toString("base64") }));
  const t = Date.now();
  const res = await fetch(`${base}/api/extract`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rfx, files, vendor_name: v.name, mode: "response" }) });
  const layer = await res.json();
  if (layer.error) { console.error(m.vendor_id, layer.error); return; }
  layer.received = m.received;
  snap.layers[m.vendor_id] = [layer];
  console.log(m.vendor_id, `${((Date.now() - t) / 1000).toFixed(1)}s`, `lines=${layer.extraction.lines.length}`, `rules=${layer.extraction.rate_rules.length}`);
}));
snap.generated_at = new Date().toISOString();
fs.writeFileSync(snapPath, JSON.stringify(snap, null, 1));
console.log("saved", snapPath);
