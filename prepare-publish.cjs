const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const output = path.resolve(root, 'dist');
if (output !== path.join(root, 'dist')) throw new Error('Unexpected publish directory');
fs.mkdirSync(output, { recursive: true });

for (const file of ['index.html', 'styles.css', 'app.js', 'config.js', 'supabase-client.js', 'service-worker.js']) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
fs.cpSync(path.join(root, 'public'), path.join(output, 'public'), { recursive: true });
process.stdout.write(`Static site prepared in ${output}\n`);
