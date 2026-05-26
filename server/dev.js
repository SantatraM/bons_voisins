import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const shell = process.platform === 'win32';

console.log('');
console.log('Contacts La Residence - mode developpement');
console.log('API Express : http://localhost:3000');
console.log('Interface   : http://localhost:5173');
console.log('');

const processes = [];

function start(name, script) {
  const command = `${npm} run ${script}`;
  const child = spawn(command, {
    stdio: 'inherit',
    shell: true,
    windowsHide: false
  });

  child.on('error', (error) => {
    console.error(`[${name}] Impossible de lancer le processus : ${error.message}`);
    stop('SIGTERM');
  });

  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] Processus arrêté avec le code ${code}.`);
      stop('SIGTERM');
    }
  });

  processes.push(child);
}

start('serveur', 'dev:server');
start('frontend', 'dev:client');

function stop(signal) {
  for (const child of processes) {
    if (!child.killed) child.kill(signal);
  }
  process.exit(signal === 'SIGINT' ? 0 : 1);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
