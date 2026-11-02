// Сборка клиента и сервера в dist/ для формирования артефакта
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
for (const item of ['src', 'public', 'migrations', 'scripts', 'package.json', 'package-lock.json', '.env.example']) {
  fs.cpSync(path.join(root, item), path.join(dist, item), { recursive: true });
}
// проверка, что все модули сервера загружаются (синтаксис и зависимости)
process.env.LOG_STDOUT = '0';
process.env.LOG_FILE = path.join(dist, 'build-check.log');
require(path.join(dist, 'src', 'app.js'));
fs.rmSync(process.env.LOG_FILE, { force: true });
fs.writeFileSync(path.join(dist, 'BUILD_INFO.txt'), `build ${new Date().toISOString()} commit ${process.env.GITHUB_SHA || 'local'}\n`);
console.log('Сборка готова: dist/');
process.exit(0);
