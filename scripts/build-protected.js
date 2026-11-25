const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STAGE = path.join(ROOT, 'build-stage');
const ELECTRON_BIN = path.join(ROOT, 'dist', 'win-unpacked', 'PC Media Remote.exe');

function cleanStage() {
  if (!fs.existsSync(STAGE)) return;
  const stageModules = path.join(STAGE, 'node_modules');
  if (fs.existsSync(stageModules)) {
    fs.rmdirSync(stageModules);
  }
  fs.rmSync(STAGE, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function main() {
  if (!fs.existsSync(ELECTRON_BIN)) {
    console.log('[1/4] Preparing Electron 45 binary...');
    execFileSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['electron-builder', '--win', '--dir'],
      { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' }
    );
  }

  console.log('[2/4] Preparing bytecode staging directory...');
  cleanStage();
  fs.mkdirSync(path.join(STAGE, 'src'), { recursive: true });
  fs.mkdirSync(path.join(STAGE, 'electron'), { recursive: true });

  copyDir(path.join(ROOT, 'public'), path.join(STAGE, 'public'));
  if (fs.existsSync(path.join(ROOT, 'build'))) {
    copyDir(path.join(ROOT, 'build'), path.join(STAGE, 'build'));
  }
  fs.copyFileSync(path.join(ROOT, 'electron', 'index.html'), path.join(STAGE, 'electron', 'index.html'));
  fs.copyFileSync(path.join(ROOT, 'electron', 'preload.js'), path.join(STAGE, 'electron', 'preload.js'));

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  pkg.build = {
    ...pkg.build,
    directories: { output: '../dist' },
    files: [
      'server.js',
      'server.jsc',
      'src/**/*',
      'public/**/*',
      'electron/**/*',
      'package.json',
    ],
  };
  fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify(pkg, null, 2));

  // Junction node_modules into stage
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(STAGE, 'node_modules'), 'junction');

  console.log('[3/4] Compiling JS to Electron V8 bytecode (.jsc) via bytenode...');
  const targets = [
    { src: 'server.js', out: 'server.jsc', exportModule: true },
    { src: 'src/mediaController.js', out: 'src/mediaController.jsc', exportModule: true },
    { src: 'src/network.js', out: 'src/network.jsc', exportModule: true },
    { src: 'electron/main.js', out: 'electron/main.jsc', exportModule: false },
  ];

  const compileScript = `
    const path = require('path');
    const bytenode = require(${JSON.stringify(path.join(ROOT, 'node_modules', 'bytenode'))});
    const targets = ${JSON.stringify(targets)};
    for (const t of targets) {
      bytenode.compileFile({
        filename: path.join(${JSON.stringify(ROOT)}, t.src),
        output: path.join(${JSON.stringify(STAGE)}, t.out),
      });
    }
  `;

  const compileRes = spawnSync(ELECTRON_BIN, ['-e', compileScript], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  });
  if (compileRes.status !== 0) {
    throw new Error(`Bytenode compilation failed with exit code ${compileRes.status}`);
  }

  for (const t of targets) {
    const jscName = `./${path.basename(t.out)}`;
    const stub = t.exportModule
      ? `require('bytenode');\nmodule.exports = require('${jscName}');\n`
      : `require('bytenode');\nrequire('${jscName}');\n`;
    fs.writeFileSync(path.join(STAGE, t.src), stub, 'utf8');
  }

  console.log('[4/4] Packaging protected .exe with electron-builder...');
  execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['electron-builder', '--win', '--projectDir', STAGE],
    { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' }
  );

  cleanStage();
  console.log('✓ Protected bytenode .exe build complete in dist/');
}

try {
  main();
} catch (err) {
  cleanStage();
  console.error('Build failed:', err);
  process.exit(1);
}
