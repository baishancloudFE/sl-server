const cores = require('os').cpus()
const server = require('net').createServer()
const {fork} = require('child_process')
const {port} = require('./config')

server.listen(port, () => {
  cores.forEach(createWorker)
  console.log(`open the SL server on port ${port}.`)
})

/**
 * 创建工作进程
 */
function createWorker() {
  const worker = fork('./worker.js')

  worker.on('exit', () => onWorkerExit(worker))
  worker.send('server', server)
}

/**
 * 当工作进程退出时，重启工作进程
 * @param {ChildProcess} worker
 */
function onWorkerExit(worker) {
  worker.kill('SIGHUP')
  createWorker()
}