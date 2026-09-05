import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const target = process.argv[2] ?? 'universal-apple-darwin';
const targets = ['universal-apple-darwin', 'aarch64-apple-darwin', 'x86_64-apple-darwin'];
if (process.platform !== 'darwin') throw new Error('macOS 安装包必须在 Mac 上构建。');
if (!targets.includes(target) || process.argv.length > 3) throw new Error(`目标必须是 ${targets.join(', ')}`);
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: project, stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 失败 (${result.status})`);
}
run('pnpm', ['test']);
run('cargo', ['fmt', '--manifest-path', 'src-tauri/Cargo.toml', '--', '--check']);
run('cargo', ['clippy', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--all-targets', '--', '-D', 'warnings']);
run('cargo', ['test', '--locked', '--manifest-path', 'src-tauri/Cargo.toml']);
run(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'build', '--target', target, '--bundles', 'app,dmg', '--', '--locked'], {
  ...process.env, APPLE_SIGNING_IDENTITY: process.env.APPLE_SIGNING_IDENTITY || '-',
});

const { version, productName } = JSON.parse(fs.readFileSync(path.join(project, 'src-tauri/tauri.conf.json'), 'utf8'));
const bundle = path.join(project, 'src-tauri/target', target, 'release/bundle');
const app = path.join(bundle, 'macos', `${productName}.app`);
const output = path.join(project, 'release', 'macos', target, version);
fs.mkdirSync(output, { recursive: true });
// Verify both slices of the universal binary before archiving the bundle.
const architectures = target === 'universal-apple-darwin' ? ['arm64', 'x86_64']
  : [target.startsWith('aarch64') ? 'arm64' : 'x86_64'];
run('/usr/bin/lipo', [path.join(app, 'Contents/MacOS/jingreader'), '-verify_arch', ...architectures]);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
const zipName = `${productName}_${version}_${target}.app.zip`;
run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, path.join(output, zipName)]);
const dmgs = fs.readdirSync(path.join(bundle, 'dmg')).filter(name => name.endsWith('.dmg') && name.includes(version));
if (dmgs.length !== 1) throw new Error('预期一个当前版本 DMG，请检查构建目录。');
for (const name of dmgs) fs.copyFileSync(path.join(bundle, 'dmg', name), path.join(output, name));
const artifacts = [...dmgs, zipName].map(file => {
  const data = fs.readFileSync(path.join(output, file));
  return { file, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
});
fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), artifacts.map(a => `${a.sha256}  ${a.file}`).join('\n') + '\n');
fs.writeFileSync(path.join(output, 'release-manifest.json'), JSON.stringify({
  version, target, architectures, minimumSystemVersion: '14.2',
  // This metadata does not claim Developer ID signing or notarization from env vars alone.
  distribution: 'requires-release-verification', artifacts,
}, null, 2) + '\n');
console.log(`macOS 产物：${output}`);
