import { readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultSourceRoot = fileURLToPath(new URL("../src", import.meta.url));
const sourceRoot = resolve(process.argv[2] || defaultSourceRoot);

function findSpecFiles(directory) {
  const matches = [];
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...findSpecFiles(entryPath));
    } else if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith(".spec.ts")
    ) {
      matches.push(entryPath);
    }
  }

  return matches;
}

const specFiles = findSpecFiles(sourceRoot);

if (specFiles.length > 0) {
  console.error(
    "Build source check failed: files ending in .spec.ts are not allowed in the compiled source tree."
  );
  for (const file of specFiles) {
    console.error(`  ${relative(sourceRoot, file)}`);
  }
  process.exitCode = 1;
}
