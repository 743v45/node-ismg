const { EventEmitter } = require('events')
const _ = require('lodash');
const moment = require('moment');
const cmdCfg = require('./commandsConfig')
const utils = require('./utils')

class Connection extends EventEmitter {
  /**
   *
   * @param {*} ismg
   * @param {*} socket
   */
  constructor(ismg, socket) {
    super()
    this.socket = socket
    this.ismg = ismg
    this.sequencePromiseMap = {}
    this.sequenceHolder = 0 // 用于请求的消息流水号
    this._connected = false // socket 连接状态
    this._authenticated = false // 合法 SP 身份
    this.headerLength = 12
    this.MaxVersion = 0x20 // 目前只支持 CMPP 2.0
    // this.currentVersion = 0x20 // 默认版本
    this.host = `${socket.remoteAddress}:${socket.remotePort}` // 客户端 Host
    this.debug = require('debug')(`ismg:connection:${this.host}`)
    // this._connectedTime = moment();
    // 无动静的情况
    this._lastCommandTime = moment();

    socket.on('error', this._onError.bind(this));
    socket.on('close', this._onClose.bind(this));
    socket.on('data', this._onData.bind(this));
  }

  isConnected() {
    return this._connected;
  }

  getMaxVersion() {
    return this.MaxVersion;
  }

  getIsmg() {
    return this.ismg;
  }

  isAuthenticated() {
    return this._authenticated;
  }

  handleNoCommand() {
    const _this = this;
    // 超过 30 分钟无传输数据, 断开连接
    if (_this._lastCommandTime <= moment().subtract('30', 'minutes')) {
      _this.disconnect()
      return;
    }

    _this.noCommand = setTimeout(function () {
      _this.handleNoCommand();
    }, 60 * 1000);
  }


  destroySocket() {
    this.debug('destroySocket');
    this.isReady = false
    if (this.socket) {
      this.socket.end()
      this.socket.destroy()
      this.socket = undefined
    }
  }

  _onClose() {
    this.debug('closed');
    this._connected = false;
    this._authenticated = false;
    this.emit('close');
  }

  _onError() {
    this._connected = false;
    this._authenticated = false;
  }

  _onData(buffer) {
    if (!this.bufferCache) {
      this.bufferCache = buffer
    }
    else {
      this.bufferCache = Buffer.concat([this.bufferCache, buffer])
    }
    const obj = { header: undefined, buffer: undefined }
    while (this.fetchData(obj)) {
      const body = this.readBody(obj.header.Command_Id, obj.buffer.slice(this.headerLength))
      this.handleBuffer(obj.header, body)
    }
  }

  /**
   * 截取完整的一个包数据, 完整取 true, 不完整取 false
   * @param {object} obj
   * @param {?object} obj.header
   * @param {?Buffer} obj.buffer
   * @returns {boolean}
   */
  fetchData(obj) {
    if (!obj)
      return false
    if (this.bufferCache.length < 12)
      return false
    obj.header = this.readHeader(this.bufferCache)
    if (this.bufferCache.length < obj.header.Total_Length)
      return false
    obj.buffer = this.bufferCache.slice(0, obj.header.Total_Length)
    this.bufferCache = this.bufferCache.slice(obj.header.Total_Length)
    return true
  }

  /**
   *
   * @param {Buffer} buffer
   * @returns {object}
   */
  readHeader(buffer) {
    const obj = {}
    obj.Total_Length = buffer.readUInt32BE(0)
    obj.Command_Id = buffer.readUInt32BE(4)
    obj.Sequence_Id = buffer.readUInt32BE(8)
    return obj
  }

  getHeaderBuffer(header) {
    const buffer = Buffer.alloc(this.headerLength)
    buffer.writeUInt32BE(header.Total_Length, 0)
    buffer.writeUInt32BE(header.Command_Id, 4)
    buffer.writeUInt32BE(header.Sequence_Id, 8)
    return buffer
  }

  /**
   * @param {*} header
   * @param {*} body
   */
  handleBuffer(header, body) {
    // 第一条信息必须是 CMPP_CONNECT
    //（不考虑 CMPP_ACTIVE_TEST / CMPP_ACTIVE_TEST_RESP）
    if (!this.isResponse(header.Command_Id) && !this.isAuthenticated() &&
      header.Command_Id !== cmdCfg.Commands.CMPP_CONNECT &&
      header.Command_Id !== cmdCfg.Commands.CMPP_ACTIVE_TEST) {
      this.disconnect();
      return;
    }

    if (header.Command_Id === cmdCfg.Commands.CMPP_CONNECT) {
      this.handleConnect(header, body)
      return
    }

    if (header.Command_Id === cmdCfg.Commands.CMPP_TERMINATE) {
      this.handleTerminate(header, body)
      return
    }

    if (header.Command_Id === cmdCfg.Commands.CMPP_SUBMIT) {
      this.handleSubmit(header, body)
      return
    }

    if (header.Command_Id === cmdCfg.Commands.CMPP_QUERY) {
      this.handleQuery(header, body)
      return
    }

    if (header.Command_Id === cmdCfg.Commands.CMPP_CANCEL) {
      this.handleCancel(header, body)
      return
    }

    if (header.Command_Id === cmdCfg.Commands.CMPP_ACTIVE_TEST) {
      this.handleActiveTest(header, body)
      return
    }

    if (this.isResponse(header.Command_Id)) {
        const promise = this.popPromise(header.Sequence_Id)
        if (!promise) {
            this.emit('error', new Error(cmdCfg.Commands[header.Command_Id] + ': resp has no promise handle it'))
            return
        }
        clearTimeout(promise._timeoutHandle)
        if (this.hasError(body)) {
            let result = 'result:' + (cmdCfg.Errors[body.Result] || body.Result)
            if (header.Command_Id === cmdCfg.Commands.CMPP_CONNECT_RESP)
                result = 'status:' + (cmdCfg.Status[body.Status] || body.Status)
            const msg = 'command:' + cmdCfg.Commands[header.Command_Id] + ' failed. result:' + result
            promise.reject(new Error(msg))
        }
        else {
            promise.resolve({ header: header, body: body })
        }
        return
    }
    this.emit('error', new Error(cmdCfg.Commands[header.Command_Id] + ': no handler found'))
    return
  }

  /**
   * 连接
   * 传入账号
   */
  async handleConnect(header, body) {
    let _this = this
    const {
      Source_Addr, AuthenticatorSource, Version, Timestamp
    } = body

    const result = {
      Status: 0,
      AuthenicatorISMG: '',
      Version: _this.MaxVersion,
    };

    if (Version > _this.MaxVersion) {
      result.Status = 4 // 版本太高
      return _this.sendResponse(cmdCfg.Commands.CMPP_CONNECT_RESP, header.Sequence_Id, result);
    }

    if (!moment(String(Timestamp), 'MMDDHHmmss').isValid()) {
      result.Status = 1 // 消息结构错误
      return _this.sendResponse(cmdCfg.Commands.CMPP_CONNECT_RESP, header.Sequence_Id, result);
    }

    const auth = await _this.ismg.authentication({
      Source_Addr,
      AuthenticatorSource,
      Timestamp,
      Host: this.host, // 用于鉴定 IP 有效性
    })

    result.Status = auth.Status
    result.AuthenicatorISMG = auth.AuthenicatorISMG

    if (result.Status === 0) {
      this._authenticated = true
    }

    return _this.sendResponse(cmdCfg.Commands.CMPP_CONNECT_RESP, header.Sequence_Id, result)
  }

  /**
   * SP 提交的拆除连接处理
   * @param {*} body
   * @param {*} header
   */
  handleTerminate(header, body) {
    this.emit('terminated')
    this._connected = false
    this._authenticated = false
    this.sendResponse(cmdCfg.Commands.CMPP_TERMINATE_RESP, header.Sequence_Id).catch(() => {}).finally(() => {
      _this.destroySocket()
    });
  }

  handleSubmit(header, body) {
    // todo
  }

  handleQuery(header, body) {
    // todo
  }

  handleCancel(header, body) {
    // todo
  }

  /**
   * 回复心跳
   * @param {*} body
   * @param {*} header
   */
  handleActiveTest(header, body) {
    return this.sendResponse(cmdCfg.Commands.CMPP_ACTIVE_TEST_RESP, header.Sequence_Id)
  }

  // 主动断开连接
  disconnect() {
    this.debug('disconnect');
    const _this = this
    // this.isReady = false
    // clearTimeout(this.heartbeatHandle)
    return this.send(cmdCfg.Commands.CMPP_TERMINATE).catch(function () { }).finally(function () {
      _this.destroySocket()
    })
  }

  // 响应客户端
  sendResponse(command, sequence, body) {
    const buf = this.getBuf({ Sequence_Id: sequence, Command_Id: command }, body)
    this.debug('%s respond buffer:', command, buf.inspect());

    return new Promise((resolve, reject) => {
      this.socket.write(buf, () => {
        resolve();
      });
    })
  }

  // 主动向客户端发送请求
  send(command, body) {
    const _this = this
    this.sequenceHolder = this.sequenceHolder >= 0xffffffff ? 1 : this.sequenceHolder + 1;
    const sequence = this.sequenceHolder
    const buf = this.getBuf({ Sequence_Id: sequence, Command_Id: command }, body)
    this.debug('%s send buffer:', command, buf.inspect())
    this.socket.write(buf)
    const deferred = utils.defer()
    this.pushPromise(sequence, deferred)
    let timeout = this.ismg.timeout
    if (command === cmdCfg.Commands.CMPP_ACTIVE_TEST)
        timeout = this.ismg.heartbeatTimeout
    deferred['_timeoutHandle'] = setTimeout(function () {
        if (command !== cmdCfg.Commands.CMPP_ACTIVE_TEST) {
            _this.emit('timeout', cmdCfg.Commands[command])
        }
        const msg = 'command:' + cmdCfg.Commands[command] + ' timeout.'
        deferred.reject(new Error(msg))
        _this.popPromise(sequence);
    }, timeout)
    return deferred.promise
  }

  hasError(body) {
    return body.Status !== void 0 && body.Status > 0 || body.Result !== void 0 && body.Result > 0
  }

  isResponse(Command_Id) {
    return Command_Id > 0x80000000
  }

  pushPromise(sequence, deferred) {
    if (!this.sequencePromiseMap[sequence])
      this.sequencePromiseMap[sequence] = deferred
    else if (_.isArray(this.sequencePromiseMap[sequence]))
      this.sequencePromiseMap[sequence].push(deferred)
    else
      this.sequencePromiseMap[sequence] = [this.sequencePromiseMap[sequence], deferred]
  }

  popPromise(sequence) {
    if (!this.sequencePromiseMap[sequence])
        return
    if (_.isArray(this.sequencePromiseMap[sequence])) {
        const promise = this.sequencePromiseMap[sequence].shift()
        if (_.isEmpty(this.sequencePromiseMap[sequence]))
            delete this.sequencePromiseMap[sequence]
        return promise
    }
    const promise = this.sequencePromiseMap[sequence]
    delete this.sequencePromiseMap[sequence]
    return promise
  }

  readBody(command, buffer) {
    const _this = this
    const obj = {}
    let commandStr
    if (_.isNumber(command))
      commandStr = cmdCfg.Commands[command]
    else
      commandStr = command
    const commandDesp = cmdCfg.CommandsDescription[commandStr]
    // 无消息实体, 不解析
    if (!commandDesp)
      return obj
    commandDesp.forEach(function (field) {
      obj[field.name] = _this.getValue(buffer, field, obj)
    })

    if (command === cmdCfg.Commands.CMPP_DELIVER) {
      // 状态报告
      if (obj.Registered_Delivery === 1) {
          obj.Msg_Content = this.readBody('CMPP_DELIVER_REPORT_CONTENT', obj.Msg_Content)
      }
      else {
        switch (obj.Msg_Fmt) {
          case 15: // gb 汉字
            obj.Msg_Content = iconv.decode(obj.Msg_Content, 'gbk');
            break;
          case 8: // ucs2
            obj.Msg_Content = Buffer.from(obj.Msg_Content).swap16().toString('ucs2');
            break;
          case 4: // 二进制信息
          case 3: // 短信写卡操作(未知类型)
            obj.Msg_Content = Buffer.from(obj.Msg_Content).toString('utf8');
            break;
          case 0: // ASCII串
            obj.Msg_Content = Buffer.from(obj.Msg_Content).toString('ascii');
            break;
        }
      }
    }
    return obj
  }

  /**
   * 从 Buffer 截取 Filed
   * @param {!Buffer} buffer
   * @param {!object} field
   * @param {} filed.name -解析后字段名称
   * @param {!string} filed.type - 解析后的类型
   * @param {!number|Function} filed.length - 长度 / 计算长度的方法
   * @param {!Object} obj
   */
  getValue(buffer, field, obj) {
    const length = obj._length || 0
    if (length >= buffer.length)
        return
    const fieldLength = this.getLength(field, obj)
    obj._length = length + fieldLength
    if (field.type === 'number') {
        const bitLength = fieldLength * 8
        let method = 'readUInt' + bitLength + 'BE'
        if (bitLength === 8)
            method = 'readUInt' + bitLength
        return buffer[method](length)
    }
    else if (field.type === 'string') {
        const value = buffer.toString(field.encoding || 'ascii', length, length + fieldLength)
        return value.replace(/\0+$/, '')
    }
    else if (field.type === 'buffer') {
        return buffer.slice(length, length + fieldLength)
    }
  }

  writeBuf(buffer, field, body) {
    const length = body._length || 0
    const fieldLength = this.getLength(field, body)
    let value = body[field.name]
    body._length = length + fieldLength
    if (value instanceof Buffer) {
        value.copy(buffer, length, 0, fieldLength)
    }
    else {
        if (field.type === 'number' && _.isNumber(value)) {
            const bitLength = fieldLength * 8
            let method = 'writeUInt' + bitLength + 'BE'
            if (bitLength === 8)
                method = 'writeUInt' + bitLength
            buffer[method](value, length)
        }
        else if (field.type === 'string') {
            if (!value)
                value = ''
            buffer.write(value, length, fieldLength, field.encoding || 'ascii')
        }
    }
  }

  getBuf(header, body) {
    header.Total_Length = this.headerLength
    let headBuf, bodyBuf
    if (body) {
        bodyBuf = this.getBodyBuffer(header.Command_Id, body)
        header.Total_Length += bodyBuf.length
    }
    headBuf = this.getHeaderBuffer(header)
    if (bodyBuf)
        return Buffer.concat([headBuf, bodyBuf])
    else
        return headBuf
  }

  getBodyBuffer(command, body) {
    const _this = this
    const buffer = Buffer.alloc(1024 * 1024, 0)
    const commandStr = cmdCfg.Commands[command]
    const commandDesp = cmdCfg.CommandsDescription[commandStr]
    if (!commandDesp)
        return buffer.slice(0, 0)
    body._length = 0
    commandDesp.forEach(function (field) {
      _this.writeBuf(buffer, field, body)
    })
    return buffer.slice(0, body._length)
  }

  getLength(field, obj) {
    if (_.isFunction(field.length)) {
      return field.length(obj)
    }
    return field.length
  }

  end() {
    this._socket.end.apply(this._socket, arguments);
  }

  write() {
    // todo
  }
}

module.exports = Connection;