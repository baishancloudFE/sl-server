const fs = require('fs')
const path = require('path')
const chalk = require('chalk')
const crypto = require('crypto')
const signal = require('./signal')
const {projectsDir} = require('./config')

/**
 * MD5
 * @param  {String|Buffer} str
 * @return {Buffer}
 */
exports.md5 = str => {
  const hash = crypto.createHash('md5')
  hash.update(str)
  return hash.digest()
}

/**
 * 文件夹检测
 * @param {String} checkpath 文件或文件夹路径
 * @param {Function} callback
 */
exports.dirCheck = (checkpath, callback) => {
  const dirs = checkpath.split(/\\+|\/+/)

  dirs[dirs.length - 1].indexOf('.') > -1 && dirs.pop()
  checkAndCreate(dirs, callback)

  /**
   * 检查并创建文件夹
   * @param {Array[String]} dirs 文件夹名数组
   * @param {Function} callback
   */
  function checkAndCreate(dirs, callback) {
    const thePath = path.posix.join.apply(null, dirs)

    fs.mkdir(thePath, (err, stats) => {
      // 已存在 or 创建成功
      if (!err || err.code === 'EEXIST')
        return callback(null, stats)

      // 父级文件夹不存在
      if (err.code === 'ENOENT')
        return checkAndCreate(dirs.slice(0, -1), () => checkAndCreate(dirs, callback))

      callback(err)
    })
  }
}

/**
 * 读取该文件夹下的所有文件
 * @param {String} dir     文件夹路径
 * @param {RegExp} ignore  不包含的文件路径正则
 * @return {Array[String]} 读取到的文件列表
 */
exports.readFiles = (dir, ignore) => {
  const files = []

  let exist = false
  try {exist = fs.statSync(dir).isDirectory()}
  catch(e) {}

  exist && readDir(dir, files, ignore)
  return files
}

function readDir(dir, result, ignore) {
  const list = fs.readdirSync(dir)

  list.forEach(name => {
    if (ignore && ignore.test(name)) return

    const namePath = path.join(dir, name)
    const stats = fs.statSync(namePath)

    if (stats.isFile()) result.push(namePath)
    else readDir(namePath, result)
  })
}

/**
 * 相对路径转绝对路径
 * @param  {Socket} socket
 * @param  {String} relative 相对路径
 * @return {String} 绝对路径
 */
exports.relativeToAbsolute = (socket, relative = '') => {
  return path.posix.resolve(
    projectsDir,
    socket.uid,
    socket.project,
    relative
  )
}

/**
 * 安装依赖包
 * 
 * 按照 package.json 中的 dependencies 安装依赖
 * 会锁定依赖包的版本号，无论是否使用泛匹配
 * 
 * @param {String} packageJsonPath package.json 的路径
 * @param {String} prefix          安装路径
 * @param {Function} cb
 * @param {Function} console       打印函数
 */
exports.install = (packageJsonPath, prefix, cb, console = () => {}) => {
  const npm = require('npm')

  const {dependencies} = require(packageJsonPath)
  const modules = Object.keys(dependencies).map(package => {
    const isGeneric = dependencies[package][0] === '~' || dependencies[package][0] === '^'
    const version = isGeneric ? dependencies[package].slice(1) : dependencies[package]

    return `${package}@${version}`
  })

  npm.load({prefix, registry: 'https://registry.npm.taobao.org'}, function (err) {
    if (err) {
      global.console.error(err)
      console(chalk.red('\n\n> Server error: Failed to load npm.\n'))
      return
    }

    console(chalk.gray('> Installing packages. This might take a couple of minutes.'))

    npm.install(prefix, ...modules, function (err) {
      if (err) {
        global.console.error(err)
        console(chalk.red('\n\n> Server error: Failed to install dependencies.\n'))
        return
      }

      console(chalk.green('> Installed.'))
      cb && cb()
    })
  })
}

/**
 * 向客户端控制台打印信息
 * @param {Socket} socket 
 * @param {String} info    要打印的信息
 */
exports.clientConsole = socket => (info = '') => {
  socket.write(signal.encode(signal.SERVER_CONSOLE, Buffer.from(info)))
}