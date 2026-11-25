// Builds the SureFrame desktop connector for Claude Desktop (an MCP Bundle, .mcpb).
//   node build.mjs  -> dist/bundle, dist/sureframe-<version>.mcpb, and a copy the site serves
//                      (apps/web/public/connector/sureframe.mcpb)
// icon.png is the site's own icon (apps/web/src/app/icon.svg) at 512px. Needs npx (@anthropic-ai/mcpb).
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const bundle = join(dist, "bundle");
// One version number: src/manifest.json's, which Claude Desktop shows. The server reads it from there when it runs
// (server/index.js); package.json has to say the same.
const { version } = JSON.parse(readFileSync(join(here, "src/manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(here, "src/package.json"), "utf8")).version;
if (pkg !== version) throw new Error(`src/package.json says version ${pkg} but src/manifest.json says ${version}: make them the same, then build again.`);

rmSync(dist, { recursive: true, force: true });
cpSync(join(here, "src"), bundle, { recursive: true });
copyFileSync(join(here, "icon.png"), join(bundle, "icon.png"));
const mcpb = ["-y", "@anthropic-ai/mcpb@2.1.2"];
execFileSync("npx", [...mcpb, "validate", join(bundle, "manifest.json")], { stdio: "inherit" });
const out = join(dist, `sureframe-${version}.mcpb`);
execFileSync("npx", [...mcpb, "pack", bundle, out], { stdio: "inherit" });
const site = join(here, "../web/public/connector");
mkdirSync(site, { recursive: true });
copyFileSync(out, join(site, "sureframe.mcpb"));
console.log(`Built SureFrame desktop connector ${version}: ${out}`);
