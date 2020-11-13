const _ = require('lodash');
const { EventEmitter } = require('events');
const net = require('net');
const Connection = require('./connection');

class ISMG extends EventEmitter {
  constructor() {
    super()
    const self = this;

    self._conns = {};
    self._onservice = true;
    self.timeout = 30 * 1000;
    self.heartbeatTimeout = 60 * 1000;
    self.debug = require('debug')('ismg:server');
    self.setHeartbeatTimeout();
    self.setTimeout();
    self.setPort();
    self.setAuthentication();

    self._init()
  }

  _init() {
    let self = this;

    self._server = net.createServer(function(socket) {
      const conn = new Connection(self, socket);
      conn._connected = true;

      const key = conn.host;

      conn.on('close', () => {
        delete self._conns[key];
      });

      self._conns[key] = conn;
    });

    setInterval(() => {
      self.debug('There are currently %d connections', _.size(self._conns));
    }, 10 * 1000);
  }

  /**
   * 设置端口
   * @param {number} port
   */
  setPort(port = 7890) {
    this.port = port;
  }

  /**
   * @returns {number}
   */
  getPort() {
    return this.port;
  }

  /**
   * 设置超时
   * @param {number} timeout - 请求超时 ms
   */
  setTimeout(timeout = 30 * 1000) {
    this.timeout = timeout;
  }

  /**
   * 设置心跳超时
   * @param {number} heartbeatTimeout - 心跳超时 ms
   */
  setHeartbeatTimeout(heartbeatTimeout = 60 * 1000) {
    this.heartbeatTimeout = heartbeatTimeout;
  }

  /**
   * 设置鉴权方法
   * @param {!function} authentication
   */
  setAuthentication(authentication) {
    // 鉴权模块, 默认不鉴权
    this.authentication = authentication || function ({Source_Addr, AuthenticatorSource, Timestamp, Host} = {}) {
      return {
        Status: 0,
        AuthenicatorISMG: '',
      };
    };

    return this;
  }

  /**
   * 获取鉴权方法
   */
  getAuthentication() {
    return this.authentication;
  }


  closeConnection(callback) {
    this._onservice = false;
    // 拒绝新链接
    this._server.close(callback);
    const self = this;
    if (this._processing) {
      this.once('ISMG_DONE', endConnections);
    } else {
      endConnections();
    }

    // 关闭旧链接
    // 如果立即关闭，会导致被拒绝的新请求，无法输出 please retry 错误给客户端
    // 导致客户端超时
    function endConnections() {
      setTimeout(() => {
        for (var key in self._conns) {
          self._conns[key].end();
        }
      }, 100);
    }
  }

  listen(port, callback) {
    if (port) this.setPort(port);

    this._server.listen(this.getPort(), function(err) {
      if (err) {
        console.error(err.stack);
        process.exit(1);
      }
      console.log('worker %s started', process.pid);
      if (typeof callback === 'function') {
        return callback();
      }
    });
  }
}

module.exports = ISMG;
