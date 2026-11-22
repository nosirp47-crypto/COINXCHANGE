import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

await mkdir('coinxchange/vendor', { recursive: true });
const result = await build({
  stdin: {
    contents: "export { createClient } from '@supabase/supabase-js';",
    resolveDir: process.cwd(),
    sourcefile: 'supabase-browser-entry.js'
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'eof',
  metafile: true,
  outfile: 'coinxchange/vendor/supabase.js'
});
await writeFile(
  'coinxchange/vendor/SUPABASE_LICENSE.txt',
  await readFile('node_modules/@supabase/supabase-js/LICENSE', 'utf8')
);
const packages = new Map();
for (const file of Object.keys(result.metafile.inputs)) {
  if (!file.startsWith('node_modules/')) continue;
  let directory = path.dirname(path.resolve(file));
  while (directory.startsWith(path.resolve('node_modules'))) {
    try {
      const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      if (metadata.name) {
        packages.set(metadata.name, { directory, metadata });
        break;
      }
    } catch { /* Continue up to the owning package. */ }
    directory = path.dirname(directory);
  }
}
const notices = [];
for (const [name, { directory, metadata }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const files = (await readdir(directory)).filter(file => /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i.test(file));
  notices.push(name + ' ' + metadata.version + ' — ' + (metadata.license || 'See license below'));
  if (!files.length) throw new Error('Missing license file for bundled dependency ' + name);
  for (const file of files.sort()) notices.push(await readFile(path.join(directory, file), 'utf8'));
}
await writeFile('coinxchange/vendor/THIRD_PARTY_NOTICES.txt', notices.join('\n\n') + '\n');
console.log('Built the local Supabase browser SDK. No CDN is needed at runtime.');
