import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'website/dist');
await mkdir(output, { recursive: true });
let html = await readFile(path.join(root, 'website/index.html'), 'utf8');
for (const file of ['style.css', 'app.js']) {
  const content = await readFile(path.join(root, 'website', file));
  const fingerprint = createHash('sha256').update(content).digest('hex').slice(0, 12);
  const extension = path.extname(file);
  const name = `${path.basename(file, extension)}.${fingerprint}${extension}`;
  await writeFile(path.join(output, name), content);
  html = html.replace(`"${file}"`, `"${name}"`);
}
await writeFile(path.join(output, 'index.html'), html);
for (const [directory, files, source] of [
  ['brand', ['favicon.svg', 'dsh-tavern-lockup.svg'], 'docs/assets/brand'],
  ['screens', ['promo-video.jpg', 'script-mode.png', 'card-editor.png', 'mvu-status-panel.png', 'rewrite-body.png', 'scene-image-product.png', 'overview.png'], 'docs/images/readme'],
  ['testimonials', (await readdir(path.join(root, 'docs/images/readme/testimonials'))).filter(file => /\.(jpg|png|webp)$/.test(file)), 'docs/images/readme/testimonials'],
]) {
  await mkdir(path.join(output, 'assets', directory), { recursive: true });
  for (const file of files) await cp(path.join(root, source, file), path.join(output, 'assets', directory, file));
}
console.log(`Website ready: ${output}`);
