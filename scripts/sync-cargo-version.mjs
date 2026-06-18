import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const cargoPath = join(root, 'src-tauri', 'Cargo.toml');
const cargo = readFileSync(cargoPath, 'utf8');

const versionPattern = /^version = ".*"$/m;
if (!versionPattern.test(cargo)) {
  console.error('Could not find version line in src-tauri/Cargo.toml');
  process.exit(1);
}

const updated = cargo.replace(versionPattern, `version = "${pkg.version}"`);

writeFileSync(cargoPath, updated);
console.log(`Synced Cargo.toml version to ${pkg.version}`);
