import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
const types = {
  'index.html': 'text/html; charset=utf-8', 'styles.css': 'text/css', 'app.js': 'text/javascript',
  'plan.js': 'text/javascript', 'assets/winter-city.png': 'image/png',
  'assets/clearskies-assistant.png': 'image/png'
};
const assets = {};
for (const [path, type] of Object.entries(types)) {
  assets['/' + path] = { type, data: (await readFile(path)).toString('base64') };
}
// Ship one ES module, including the same planning and provider code as the Node server.
const plan = (await readFile('plan.js', 'utf8')).replace(/^export function /gm, 'function ');
const service = (await readFile('air-service.js', 'utf8')).replace(/^import .*?;$/gm, '').replace(/^export \{.*?\};$/gm, '');
const worker = (await readFile('worker.js', 'utf8')).replace(/^import .*?;$/gm, '');
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
await writeFile('dist/server/index.js', [plan, service, 'const assets = '+JSON.stringify(assets)+';', worker].join('\n'));
