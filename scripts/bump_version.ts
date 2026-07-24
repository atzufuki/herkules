/**
 * Automatically bumps patch version in src/version.ts
 */
import { resolve } from "@std/path";

async function bumpVersion() {
  const versionFilePath = resolve("src/version.ts");
  let content = "";
  try {
    content = await Deno.readTextFile(versionFilePath);
  } catch {
    content = 'export const HERKULES_VERSION = "0.1.0";\n';
  }

  const match = content.match(/export const HERKULES_VERSION = "(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?";/);
  if (match) {
    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    const patch = parseInt(match[3], 10) + 1;
    const oldVersion = match[0].split('"')[1];
    const newVersion = `${major}.${minor}.${patch}`;
    const newContent = `export const HERKULES_VERSION = "${newVersion}";\n`;
    await Deno.writeTextFile(versionFilePath, newContent);
    console.log(`📦 Auto-bumped version: v${oldVersion} ➔ v${newVersion}`);
  } else {
    await Deno.writeTextFile(versionFilePath, 'export const HERKULES_VERSION = "0.1.0";\n');
    console.log(`📦 Version file initialized: v0.1.0`);
  }
}

if (import.meta.main) {
  await bumpVersion();
}
