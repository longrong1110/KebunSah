// 启动本地 Firebase 模拟器（Auth + Firestore）：npm run emulators
// 为什么不直接写一个静态配置文件，而要用脚本：
//   1. firebase.json 没有 emulators.auth 时 Auth 不会启动，而 firebase.json 是和队友共管的，这里不改（已实测）；
//   2. --config 指向的文件里，规则路径用相对路径会被判成“在项目目录之外”（项目目录 = 配置文件所在目录），
//      写成相对配置文件的路径又会找不到；找不到时模拟器会**静默退回“允许所有读写”**——这里用绝对路径并先检查文件存在；
//   3. 在 web/ 里启动，*-debug.log 就落在 web/ 下，被 web/.gitignore 忽略，不污染仓库根。
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rules = resolve(webDir, '..', 'infra', 'firestore.rules');

if (!existsSync(rules)) {
  console.error(
    `找不到 Firestore 规则文件：${rules}\n没有它模拟器会允许所有读写，测不出安全规则，所以不启动。`,
  );
  process.exit(1);
}

const config = {
  firestore: { rules },
  emulators: {
    auth: { host: '127.0.0.1', port: 9099 },
    firestore: { host: '127.0.0.1', port: 8080 },
    ui: { enabled: false },
    singleProjectMode: true,
  },
};
const configPath = join(webDir, '.emulators.json');
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

// 项目名固定 demo-kebunsah：demo- 前缀的项目不会访问线上服务
// Windows 上 firebase 是 .cmd，必须经 shell 启动；传整条命令字符串（而不是 shell + 参数数组）可避开 Node 的 DEP0190 警告
const command = `firebase emulators:start --only auth,firestore --project demo-kebunsah --config "${configPath}"`;
const child = spawn(command, { cwd: webDir, stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
