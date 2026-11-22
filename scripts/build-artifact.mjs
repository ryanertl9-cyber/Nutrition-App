// Builds dist/artifact.html: the page body for publishing as a claude.ai Artifact
// (the Artifact host supplies the <!doctype>, <head> and <body> wrapper).
// Publish it together with src/core.js, src/sync.js, src/app.js and data/foods.json at the same paths.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'app/index.html'), 'utf8');
const between = (a, b) => {
  const i = html.indexOf(a), j = html.indexOf(b);
  if (i < 0 || j < 0) throw new Error(`Marker missing: ${a} / ${b}`);
  return html.slice(i + a.length, j).trim();
};
// Accounts need outside network access, which the Artifact viewer blocks: drop those scripts there.
const body = between('<!-- ARTIFACT-BODY-START -->', '<!-- ARTIFACT-BODY-END -->').split('\n').filter((l) => !l.includes('data-hosted-only')).join('\n');
const out = between('<!-- ARTIFACT-START -->', '<!-- ARTIFACT-HEAD-END -->') + '\n' + body + '\n';
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/artifact.html'), out);
console.log(`Wrote dist/artifact.html (${(out.length / 1024).toFixed(1)} KB)`);
