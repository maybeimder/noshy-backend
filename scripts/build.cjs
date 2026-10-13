// pnpm build: compila src/ a dist/ como CommonJS (tsconfig "module": "commonjs").
// El package.json raíz declara "type": "module", así que dist/ necesita su propio package.json
// con "type": "commonjs"; si no, Node interpreta la salida como ESM y falla con "exports is not defined".
const { execFileSync } = require('node:child_process');
const { rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
// typescript no expone bin/tsc en sus "exports": se usa la ruta directa del paquete instalado.
execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(root, 'tsconfig.build.json')], {
  cwd: root,
  stdio: 'inherit'
});
writeFileSync(join(dist, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
console.log('Build listo en dist/');
