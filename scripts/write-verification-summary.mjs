import { execFileSync } from 'node:child_process';
import { appendFile, writeFile } from 'node:fs/promises';

const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const checks = [
  ['Reproducible browser SDK', 'BUNDLE_RESULT'],
  ['Actual visual-preview publish directory', 'PUBLISH_DIRECTORY_RESULT'],
  ['Isolated database ownership tests', 'DATABASE_RESULT'],
  ['Private photo client and isolated Storage ownership tests', 'PHOTOS_RESULT'],
  ['Isolated founder-count authorization tests', 'FOUNDER_RESULT'],
  ['Browser behavior with simulated provider responses', 'BROWSER_RESULT'],
  ['Cloudflare-root layout with actual blank preview configuration', 'DEPLOYMENT_ROOT_RESULT']
];
const summary = [
  '# COINXCHANGE verification evidence', '', `Tested checkout: \`${sha}\``, '',
  '| Check | Result |', '| --- | --- |',
  ...checks.map(([label, key]) => `| ${label} | ${process.env[key] || 'not recorded'} |`), '',
  'These checks do not send email or validate hosted Supabase Auth/Storage. They do not publish a site.', '',
  'Real cross-device signup/recovery, private hosted photo persistence, and owner approval remain separate release gates.', ''
].join('\n');
await writeFile('verification-summary.md', summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(`Recorded verification evidence for ${sha}.`);
