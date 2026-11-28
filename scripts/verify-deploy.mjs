import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const stagingProject = 'uyccxknjcugtvgoiukoh';
const productionProject = 'xjwjacihfrnslivolaml';

export async function verifyDeployment(directory, mode, { requireClean = false } = {}) {
  assert.ok(['visual', 'staging'].includes(mode), 'Choose the explicit visual or staging deployment mode.');
  const root = path.resolve(directory);
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /COINXCHANGE — FOUNDER EDITION/, 'Publish the Founder Edition directory, not the earlier root prototype.');

  // Resolve actual HTML links as the host does at /. This catches output-directory
  // mistakes which /coinxchange/ browser tests cannot detect.
  const markup = html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>');
  for (const match of markup.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const reference = match[1];
    if (reference.startsWith('#') || /^(?:data:|mailto:|tel:)/i.test(reference)) continue;
    const resolved = new URL(reference, 'https://deployment.invalid/');
    if (resolved.origin !== 'https://deployment.invalid') continue;
    const relative = decodeURIComponent(resolved.pathname).replace(/^\/+/, '');
    const target = path.resolve(root, relative);
    assert.ok(target.startsWith(root + path.sep), 'Asset reference escapes the publish directory.');
    assert.ok((await stat(target)).isFile(), `Missing deployed asset: ${relative}`);
  }
  for (const required of ['accounts.js', 'discovery-collection-market.js', 'vendor/supabase.js']) {
    assert.ok((await stat(path.join(root, required))).isFile(), `Missing runtime dependency: ${required}`);
  }
  // The account module loads the SDK and private-photo helper dynamically.
  // Check literal local imports as well as the initial HTML script tags.
  for (const filename of await readdir(root)) {
    if (!filename.endsWith('.js')) continue;
    const script = await readFile(path.join(root, filename), 'utf8');
    for (const match of script.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)["'](\.[^"']+)["']/g)) {
      const target = path.resolve(root, match[1]);
      assert.ok(target.startsWith(root + path.sep), 'Runtime import escapes the publish directory.');
      assert.ok((await stat(target)).isFile(), `Missing runtime import in ${filename}: ${match[1]}`);
    }
  }

  const code = await readFile(path.join(root, 'account-config.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(code, context, { timeout: 1_000 });
  const config = context.window.COINXCHANGE_CONFIG;
  assert.ok(config && typeof config === 'object', 'Account configuration is missing.');
  if (mode === 'visual') {
    assert.equal(config.supabaseUrl, '', 'Visual preview must not silently enable a backend.');
    assert.equal(config.supabasePublishableKey, '', 'Visual preview must not carry a backend key.');
  } else {
    assert.equal(config.supabaseUrl, `https://${stagingProject}.supabase.co`, 'Only the separate staging backend is allowed.');
    assert.match(config.supabasePublishableKey, /^sb_publishable_[A-Za-z0-9_-]{20,}$/, 'Staging requires a public browser key.');
    const info = JSON.parse(await readFile(path.join(root, 'build-info.json'), 'utf8'));
    assert.equal(info.environment, 'staging');
    assert.equal(info.supabaseProject, stagingProject);
    assert.equal(info.deploymentRoot, '/');
    assert.match(info.sourceCommit, /^[a-f0-9]{40}$/);
    assert.equal(typeof info.sourceDirty, 'boolean');
    if (requireClean) assert.equal(info.sourceDirty, false, 'Commit the reviewed changes and rebuild before publishing.');
    const actualFiles = [];
    async function inspect(folder, prefix = '') {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const relative = prefix + entry.name;
        if (entry.isDirectory()) await inspect(path.join(folder, entry.name), relative + '/');
        else {
          assert.ok(entry.isFile(), 'Deployment artifacts cannot contain symlinks.');
          if (relative === 'build-info.json') continue;
          actualFiles.push(relative);
          const bytes = await readFile(path.join(folder, entry.name));
          assert.equal(createHash('sha256').update(bytes).digest('hex'), info.files[relative], `Artifact fingerprint mismatch: ${relative}`);
          if (/\.(?:js|html|json|md|txt)$/.test(relative)) {
            assert.ok(!bytes.toString('utf8').includes(productionProject), 'The staging artifact contains a production project reference.');
          }
        }
      }
    }
    await inspect(root);
    assert.deepEqual(actualFiles.sort(), Object.keys(info.files).sort(), 'The artifact file list has changed.');
    assert.match(await readFile(path.join(root, 'robots.txt'), 'utf8'), /Disallow:\s*\//);
    assert.match(await readFile(path.join(root, '_headers'), 'utf8'), /X-Robots-Tag:\s*noindex/);
  }
  console.log(`PASS: ${mode} publish directory, configuration, and runtime assets verified.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [directory, mode] = process.argv.slice(2);
  if (!directory || !mode) throw new Error('Usage: node scripts/verify-deploy.mjs DIRECTORY visual|staging [--require-clean]');
  await verifyDeployment(directory, mode, { requireClean: process.argv.includes('--require-clean') });
}
