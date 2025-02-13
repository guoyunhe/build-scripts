#!/usr/bin/env node
const { fork } = require('child_process');
const parse = require('yargs-parser');
const chokidar = require('chokidar');
const detect = require('detect-port');
const path = require('path');
const log = require('../lib/utils/log');

let child = null;
const rawArgv = parse(process.argv.slice(2));
const scriptPath = require.resolve('./child-process-start.js');
const configPath = path.resolve(rawArgv.config || 'build.json');

const inspectRegExp = /^--(inspect(?:-brk)?)(?:=(?:([^:]+):)?(\d+))?$/;

async function modifyInspectArgv(execArgv, processArgv) {
  /**
   * Enable debugger by exec argv, eg. node --inspect node_modules/.bin/build-scripts start
   * By this way, there will be two inspector, because start.js is run as a child process.
   * So need to handle the conflict of port.
   */
  const result = await Promise.all(
    execArgv.map(async item => {
      const matchResult = inspectRegExp.exec(item);
      if (!matchResult) {
        return item;
      }
      const [_, command, ip, port = 9229] = matchResult;
      const nPort = +port;
      const newPort = await detect(nPort);
      return `--${command}=${ip ? `${ip}:` : ''}${newPort}`;
    }),
  );

  /**
   * Enable debugger by process argv, eg. npm run start --inspect
   * Need to change it as an exec argv.
   */
  if (processArgv.inspect) {
    const matchResult = /(?:([^:]+):)?(\d+)/.exec(rawArgv.inspect);
    let [_, ip, port = 9229] = matchResult || [];
    const newPort = await detect(port);
    result.push(`--inspect=${ip ? `${ip}:` : ''}${newPort}`);
  }

  return result;
}

function restartProcess() {
  (async () => {
    // remove the inspect related argv when passing to child process to avoid port-in-use error
    const execArgv = await modifyInspectArgv(process.execArgv, rawArgv);

    // filter inspect in process argv, it has been comsumed
    const nProcessArgv = process.argv
      .slice(2)
      .filter(arg => arg.indexOf('--inspect') === -1);
    child = fork(scriptPath, nProcessArgv, { execArgv });
    child.on('message', data => {
      if (process.send) {
        process.send(data);
      }
    });

    child.on('exit', code => {
      if (code) {
        process.exit(code);
      }
    });
  })();
}

const onUserChange = () => {
  console.log('\n');
  log.info('build.json has been changed');
  log.info('restart dev server');
  // add process env for mark restart dev process
  process.env.RESTART_DEV = true;
  child.kill();
  restartProcess();
};

module.exports = () => {
  restartProcess();

  const watcher = chokidar.watch(configPath, {
    ignoreInitial: true,
  });

  watcher.on('change', onUserChange);

  watcher.on('error', error => {
    log.error('fail to watch file', error);
    process.exit(1);
  });
};
