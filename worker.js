const fs = require('fs')
const path = require('path')
const chalk = require('chalk')
const server = require('net').createServer(onConnect)
const signal = require('./signal')
const {md5, dirCheck, readFiles, relativeToAbsolute, install, clientConsole} = require('./utils')

process.on('message', (msg, mainServer) => {
  if (msg === 'server')
    mainServer.on('connection', socket => server.emit('connection', socket))
})

/**
 * 连接处理
 * @param {Socket} socket
 */
function onConnect(socket) {
  socket.on('data', data => signal.decode(data, socket).forEach(info => handle(socket, info)))
  socket.on('end', data => console.log('disconnected from client[' + socket.uid + '].'))
}

/**
 * 接收信息处理
 * @param {Socket} socket
 * @param {Object} { type: 信号位, content: 传输内容, note: 附加信息 }
 */
function handle(socket, { type, content, note }) {
  switch (type) {
    case signal.CLIENT_INIT: return init(socket, JSON.parse(content.toString()))
    case signal.CLIENT_FILE_CHANGE: return fileCover(socket, note.toString(), content)
    case signal.CLIENT_FILE_DELETE: return fileDelete(socket, note.toString())
    case signal.CLIENT_FILE_CHECK: return fileCheck(socket, note.toString(), content)
    case signal.CLIENT_FILE_SYNC: return fileSync(socket, note.toString(), content)
    case signal.CLIENT_NUMBER_OF_CHECK_FILES: return fileCheckCallBack(socket, +content.toString())
    case signal.CLIENT_DEVELOPMENT: return development(socket)
    case signal.CLIENT_SYNC_FILES_MD5: return (socket.distIgnore = JSON.parse(content.toString()))
    case signal.CLIENT_BUILD: return build(socket)
  }
}

/**
 * 连接初始化
 * @param {Socket} socket 
 * @param {Object} info   初始化信息
 */
function init(socket, info) {
  const {uid, project, builder} = info

  socket.uid = uid
  socket.project = project
  socket.builder = builder
  socket.cache = Buffer.from('')
  socket.sync = []
  socket.checked = undefined
  socket.console = clientConsole(socket)
  socket.closed = new Promise(resolve => {
    socket.on('close', () => {
      console.log('client[' + socket.uid + '] has closed connection.')
      resolve()
    })

    socket.on('error', () => {
      console.log('client[' + socket.uid + '] has closed connection.')
      resolve()
    })
  })

  socket.write(signal.encode(signal.SERVER_INIT_DONE))
  socket.console(chalk.green('> Connection is initialized.'))
  console.log('connected to client[' + socket.uid + '].')
}

/**
 * 覆盖文件
 * @param {Socket} socket
 * @param {String} filepath 相对文件路径
 * @param {Buffer} content  文件内容
 * @param {Function} cb
 */
function fileCover(socket, filepath, content, cb) {
  const isPackageJson = filepath === 'package.json'

  filepath = relativeToAbsolute(socket, filepath)
  console.log(`cover file: ${filepath}`)

  dirCheck(filepath, (err, stats) => {
    if (err) {
      console.error(err)
      socket.console(chalk.red('> Server error: Directory check failed.'))
      return
    }

    fs.writeFile(filepath, content, err => {
      if (err) {
        console.error(err)
        socket.console(chalk.red('> Server error: File write failed.'))
        return
      }

      // 如果是 package.json 有更新，就更新依赖
      if (isPackageJson)
        socket.sync.push(new Promise((resolve, reject) => install(
          filepath,
          relativeToAbsolute(socket),
          resolve,
          socket.console
        )))

      cb && cb()
    })
  })
}

/**
 * 删除文件
 * @param {Socket} socket
 * @param {String} filepath 相对文件路径
 */
function fileDelete(socket, filepath) {
  filepath = relativeToAbsolute(socket, filepath)
  console.log(`delete file: ${filepath}`)

  fs.unlink(filepath)
}

/**
 * 文件检查
 * @param {Socket} socket
 * @param {String} filepath 相对文件路径
 * @param {Buffer} info     文件内容哈希
 */
function fileCheck(socket, filepath, info) {
  fs.readFile(relativeToAbsolute(socket, filepath), (err, file) => {
    if (err || !info.equals(md5(file)))
      socket.write(signal.encode(
        signal.SERVER_FILE_UPDATE,
        null,
        Buffer.from(filepath)
      ))

    else
      socket.checked()
  })
}

/**
 * 同步文件
 * @param {Socket} socket
 * @param {String} filepath 相对文件路径
 * @param {Buffer} content  文件内容
 */
function fileSync(socket, filepath, content) {
  const isPackageJson = filepath === 'package.json'

  socket.sync.push(new Promise((resolve, reject) => {
    const cb = !isPackageJson
      ? resolve
      : () => {
        socket.checked()
        resolve()
      }

    fileCover(socket, filepath, content, cb)
  }))

  !isPackageJson && socket.checked()
}

/**
 * 文件检查回调函数
 * @param {Socket} socket
 * @param {Number} total  同步检查的文件总数
 */
function fileCheckCallBack(socket, total) {
  socket.checked = isPackageJson => {
    if ((total -= 1) === 0)
      Promise.all(socket.sync).then(
        () => {
          socket.write(signal.encode(signal.SERVER_CHECK_OFF))
          socket.console(chalk.green('> Completed project sync.'))
        }
      )
  }
}

/**
 * 项目开发调试
 * @param {Socket} socket
 */
function development(socket) {
  const builder = require(socket.builder).dev(relativeToAbsolute(socket), socket.console)

  builder.ready.then(() => socket.write(signal.encode(signal.SERVER_DEV_SERVER_START)))
  socket.closed.then(builder.close)
}

/**
 * 项目打包
 * @param {Socket} socket
 */
function build(socket) {
  const root = relativeToAbsolute(socket)
  const builder = require(socket.builder).build(root, socket.console)

  builder.then(() => {
    const buildPath = path.join(root, 'dist')
    const files = readFiles(buildPath)

    socket.console(chalk.gray('> Waiting for sync...'))
    Promise.all(files.map(filepath => new Promise((resolve, reject) => (
      fs.readFile(filepath, (err, data) => {
        if (err) {
          console.error(err)
          socket.console(chalk.red('> Server error: Failed to read file: ' + path.relative(root, filepath)))
          return reject(err)
        }

        if (socket.distIgnore[md5(data).toString()]) return resolve()

        socket.write(signal.encode(
          signal.SERVER_BUILD_FILE_SYNC,
          data,
          Buffer.from(path.relative(buildPath, filepath))
        ), resolve)
      })
    )))).then(() => socket.console(chalk.green('> Done.')))
        .then(() => socket.write(signal.encode(signal.SERVER_FIN)))
  }).catch(err => {
    console.error(err)
    socket.console(chalk.red('> Server error: Failed to build the project.'))
  })
}