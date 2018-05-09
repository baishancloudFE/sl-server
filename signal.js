/**
 * 信号协议
 * 去除开始结束位后
 * 第一位为信号位，代表本次的数据传输的意图
 * 第二位开始至分隔符之间为附加信息，用以传递额外的信息内容
 * 分隔符后的内容为主体信息
 */
const START = Buffer.from([0x12, 0x23, 0x33])
const END = Buffer.from([0xAB, 0xCD, 0xEF])
const BOUNDARY = Buffer.from([0x10, 0x03])
const JOINT = Buffer.concat([END, START])
const MAX = 5 // 限制文件大小 5MB
const MAX_INFO_SIZE = MAX * 1024 * 1024

// 客户端信号 0~127
exports.CLIENT_INIT = 0x00
exports.CLIENT_FILE_CHANGE = 0x01
exports.CLIENT_FILE_DELETE = 0x02
exports.CLIENT_FILE_CHECK = 0x03
exports.CLIENT_FILE_SYNC = 0x04
exports.CLIENT_NUMBER_OF_CHECK_FILES = 0x05
exports.CLIENT_DEVELOPMENT = 0x06
exports.CLIENT_BUILD = 0x07
exports.CLIENT_SYNC_FILES_MD5 = 0x08

// 服务端信号 128~255
exports.SERVER_INIT_DONE = Buffer.from([0xFF])
exports.SERVER_FILE_UPDATE = Buffer.from([0xFE])
exports.SERVER_CHECK_OFF = Buffer.from([0xFD])
exports.SERVER_DEV_SERVER_START = Buffer.from([0xFC])
exports.SERVER_BUILD_FILE_SYNC = Buffer.from([0xFB])
exports.SERVER_CONSOLE = Buffer.from([0xBB])
exports.SERVER_FIN = Buffer.from([0x80])

/**
 * 解码
 * 
 * 不同的链接请使用不同的缓存区
 * 如果使用公用变量充当缓存区
 * 并发时可能会导致数据冲突
 * 
 * @param {Buffer} data
 * @param {Object} zone 缓存区
 * @return {Array[Object[Buffer]]} { type: 信号位, content: 传输内容, note: 附加信息 }
 */
exports.decode = function (data, zone) {
  return split(data).map(chunk => decode(chunk, zone)).filter(data => {
    return !data.incomplete
  })
}

/**
 * 编码
 * @param {Buffer} signal  信号位
 * @param {Buffer} content 传输内容
 * @param {Buffer} note    附加信息
 */
exports.encode = function (signal, content, note) {
  if (!Buffer.isBuffer(signal))
    throw new TypeError('signal must be a Buffer.')

  content = Buffer.isBuffer(content) ? content : Buffer.from('')
  note = Buffer.isBuffer(note) ? note : Buffer.from('')

  // 3个长度位、1个信号位
  const length = START.length + 3 + 1 + note.length + BOUNDARY.length + content.length + END.length
  const length_x16 = zeroFillBuffers(length.toString(16), 6)
  const length_buf = Buffer.alloc(3)

  if (MAX_INFO_SIZE < length) {
    console.error(`Transmission content size more than ${MAX}MB`)
    return {}
  }

  length_buf[0] = parseInt(length_x16.slice(0, 2), 16)
  length_buf[1] = parseInt(length_x16.slice(2, 4), 16)
  length_buf[2] = parseInt(length_x16.slice(4), 16)

  return Buffer.concat([START, length_buf, signal, note, BOUNDARY, content, END])
}

/**
 * 按协议分割数据
 * @param {Buffer} data 数据串
 */
function split(data) {
  const result = []

  cut(data, result)
  return result

  /**
   * 单次分割
   * @param {Buffer} data 数据串
   * @param {Array}  result
   */
  function cut(data, result) {
    const index = data.indexOf(JOINT)
  
    if (index === -1) return result.push(data)

    const slice = data.slice(0, index + END.length)
    const surplus = data.slice(index + END.length)

    result.push(slice)
    cut(surplus, result)
  }
}

/**
 * 解码
 * @param {Buffer} data
 * @param {Object} zone 缓存区
 * @return {Object[Buffer]} { type: 信号位, content: 传输内容, note: 附加信息 }
 */
function decode(data, zone) {
  // 拼接数据
  let cache = zone.cache = Buffer.concat([zone.cache || Buffer.from(''), data])

  // 如果数据不完全，继续与下一段数据拼接
  if (
    !START.equals(cache.slice(0, 3)) ||
    !END.equals(cache.slice(cache.length - 3))
  ) return { data, incomplete: true }

  // 开始处理
  const type = cache[6]
  const length = parseInt(cache.slice(3, 6).reduce((result, next) => result.toString(16) + next.toString(16)), 16)

  // 传输内容超过限制
  if (MAX_INFO_SIZE < length) {
    console.warn(`transmission content size more than ${MAX}MB`)
    return { cache, incomplete: true }
  }

  cache = cache.slice(7, cache.length - 3)
  const index = cache.indexOf(BOUNDARY)
  const note = cache.slice(0, index)
  const content = cache.slice(index + BOUNDARY.length)

  // 清空缓存
  zone.cache = Buffer.from('')

  return { type, content, note }
}

/**
 * 零比特填充
 * @param {String} content  数据内容 
 * @param {Number} length   总长度
 */
function zeroFillBuffers(content, length) {
  while (content.length < length)
    content = '0' + content

  return content
}

/**
 * #### 测试用函数 ####
 * 
 * Buffer 转 String
 * @param  {Buffer} buffer
 * @return {String}
 */
function bufferToString(buffer) {
  const chunk = []
  buffer.forEach(byte => chunk.push(byte.toString(16)))
  chunk.push('\n')
  return chunk.join(' ')
}