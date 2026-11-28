// Builds a reviewable artifact only. This script never publishes or changes a database.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDeployment } from './verify-deploy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = 'uyccxknjcugtvgoiukoh';
const url = `https://${project}.supabase.co`;
const key = process.env.COINXCHANGE_STAGING_PUBLISHABLE_KEY?.trim() || '';

if (!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key)) {
  throw new Error('Set COINXCHANGE_STAGING_PUBLISHABLE_KEY to the separate staging project’s public browser key.');
}

// Confirm that this key belongs to the fixed staging project before writing an artifact.
// This read does not send mail or create/sign in a user.
const response = await fetch(`${url}/auth/v1/settings`, {
  headers: { apikey: key }, redirect: 'error', signal: AbortSignal.timeout(15_000)
});
if (!response.ok) throw new Error(`Staging did not accept the public key (HTTP ${response.status}).`);
const settings = await response.json();
if (settings.external?.email !== true || settings.mailer_autoconfirm !== false) {
  throw new Error('Staging must have the email provider and email confirmation enabled.');
}

const sourceCommit = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const sourceDirty = Boolean(execFileSync('git', [
  'status', '--porcelain', '--untracked-files=normal', '--',
  'coinxchange', 'scripts', 'package.json', 'package-lock.json', 'supabase'
], { cwd: root, encoding: 'utf8' }).trim());
const outputParent = path.join(root, 'dist');
await mkdir(outputParent, { recursive: true });
const temporary = await mkdtemp(path.join(outputParent, '.staging-build-'));

try {
  const source = path.join(root, 'coinxchange');
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const include = entry.isFile() && (
      entry.name === 'index.html' || entry.name.endsWith('.js') || entry.name === 'MVP_BLUEPRINT.md'
    ) || entry.isDirectory() && ['assets', 'vendor'].includes(entry.name);
    if (include) await cp(path.join(source, entry.name), path.join(temporary, entry.name), { recursive: true });
  }
  await writeFile(path.join(temporary, 'account-config.js'),
    '// Separate COINXCHANGE staging project; public browser key only.\n' +
    'window.COINXCHANGE_CONFIG = Object.freeze(' + JSON.stringify({
      supabaseUrl: url, supabasePublishableKey: key
    }, null, 2) + ');\n');
  await writeFile(path.join(temporary, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  await writeFile(path.join(temporary, '_headers'),
    '/*\n  X-Robots-Tag: noindex, nofollow, nosnippet\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Content-Type-Options: nosniff\n' +
    '/account-config.js\n  Cache-Control: no-store\n/build-info.json\n  Cache-Control: no-store\n');

  const files = {};
  async function fingerprint(directory, prefix = '') {
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + child.name;
      if (child.isDirectory()) await fingerprint(path.join(directory, child.name), relative + '/');
      else if (child.isFile()) files[relative] = createHash('sha256')
        .update(await readFile(path.join(directory, child.name))).digest('hex');
      else throw new Error('Unsupported non-file artifact entry.');
    }
  }
  await fingerprint(temporary);
  await writeFile(path.join(temporary, 'build-info.json'), JSON.stringify({
    product: 'COINXCHANGE', environment: 'staging', sourceCommit, sourceDirty,
    supabaseProject: project, deploymentRoot: '/', files
  }, null, 2) + '\n');
  await verifyDeployment(temporary, 'staging');
  const output = path.join(outputParent, 'staging');
  await rm(output, { recursive: true, force: true });
  await rename(temporary, output);
  console.log('Prepared dist/staging. No deployment or database changes were made.');
  console.log(sourceDirty
    ? `Source base ${sourceCommit}; uncommitted changes are included. Commit and rebuild before publishing.`
    : `Source commit ${sourceCommit}; clean deployment source.`);
} catch (error) {
  await rm(temporary, { recursive: true, force: true });
  throw error;
}
