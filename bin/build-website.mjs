import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'website/dist');
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'style.css', 'app.js']) {
  await cp(path.join(root, 'website', file), path.join(output, file));
}
for (const [directory, files, source] of [
  ['brand', ['favicon.svg', 'dsh-tavern-lockup.svg'], 'docs/assets/brand'],
  ['screens', ['promo-video.jpg', 'script-mode.png', 'card-editor.png', 'mvu-status-panel.png', 'rewrite-body.png', 'scene-image-product.png', 'overview.png'], 'docs/images/readme'],
  ['testimonials', ['more-alive-and-faster.jpg', 'long-chat-memory.jpg'], 'docs/images/readme/testimonials'],
]) {
  await mkdir(path.join(output, 'assets', directory), { recursive: true });
  for (const file of files) await cp(path.join(root, source, file), path.join(output, 'assets', directory, file));
}
console.log(`Website ready: ${output}`);
