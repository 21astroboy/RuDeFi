import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

for (const file of ['frontend/index.html', 'frontend/app.js', 'frontend/sw.js', 'frontend/about.html', 'backend/CMakeLists.txt', 'infra/docker/Dockerfile']) {
  assert.ok(fs.existsSync(file), `Missing ${file}`);
}
new vm.Script(fs.readFileSync('frontend/app.js', 'utf8'));
assert.match(fs.readFileSync('frontend/index.html', 'utf8'), /src="\/app.js"/);
console.log('Repository layout and application script: OK');
