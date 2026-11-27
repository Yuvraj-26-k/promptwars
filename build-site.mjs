import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
const types = {
  'index.html': 'text/html; charset=utf-8', 'styles.css': 'text/css', 'app.js': 'text/javascript',
  'plan.js': 'text/javascript', 'forecast-chart.js': 'text/javascript', 'dom.js': 'text/javascript',
  'chat.js': 'text/javascript',
  'assets/winter-city.png': 'image/png',
  'assets/clearskies-assistant.png': 'image/png'
};
const assets = {};
for (const [path, type] of Object.entries(types)) {
  assets['/' + path] = { type, data: (await readFile(path)).toString('base64') };
}
// Ship one ES module with the planner, provider, and chat guard used by Node.
const modules = ['plan.js', 'air-service.js', 'chat-guard.js'];
const sharedCode = await Promise.all(modules.map(async (path) => {
  const code = await readFile(path, 'utf8');
  return code.replace(/^(?:import .*?;|export \{.*?\};)$/gm, '').replace(/^export (?=function |const )/gm, '');
}));
const worker = (await readFile('worker.js', 'utf8')).replace(/^import .*?;$/gm, '');
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
await writeFile('dist/server/index.js', [...sharedCode, 'const assets = '+JSON.stringify(assets)+';', worker].join('\n'));
