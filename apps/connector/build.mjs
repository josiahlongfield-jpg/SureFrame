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
const { version } = JSON.parse(readFileSync(join(here, "src/manifest.json"), "utf8"));

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
