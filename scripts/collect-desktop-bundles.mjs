import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleRoot = path.join(root, 'src-tauri', 'target', 'release', 'bundle');
const releaseRoot = path.join(root, 'release');
const packageExtensions = new Set(['.app', '.dmg', '.msi', '.exe']);

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function collectCandidates(directory, results = []) {
  if (!(await exists(directory))) return results;

  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(directory, entry.name);
    const extension = path.extname(entry.name);

    if (packageExtensions.has(extension)) {
      results.push(source);
      continue;
    }

    if (entry.isDirectory()) {
      await collectCandidates(source, results);
    }
  }

  return results;
}

const candidates = await collectCandidates(bundleRoot);
if (!candidates.length) {
  console.error(`No desktop bundles found under ${bundleRoot}`);
  process.exitCode = 1;
} else {
  await rm(releaseRoot, { force: true, recursive: true });
  await mkdir(releaseRoot, { recursive: true });

  for (const source of candidates) {
    const destination = path.join(releaseRoot, path.basename(source));
    await rm(destination, { force: true, recursive: true });
    await cp(source, destination, { recursive: true });
    console.log(`Copied ${path.relative(root, source)} -> ${path.relative(root, destination)}`);
  }
}
