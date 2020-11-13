```
    _   __ ____   ____   ______       ____ _____  __  ___ ______
   / | / // __ \ / __ \ / ____/      /  _// ___/ /  |/  // ____/
  /  |/ // / / // / / // __/ ______  / /  \__ \ / /|_/ // / __
 / /|  // /_/ // /_/ // /___/_____/_/ /  ___/ // /  / // /_/ /
/_/ |_/ \____//_____//_____/      /___/ /____//_/  /_/ \____/
```


# Simple example

```javascript
const { Ismg } = require('ismg');

const ismg = new Ismg();
const port = 7890;

ismg.listen(port,  () => {
  console.log(new Date() + ` Server is listening on port ${port}`);
});
```

# Usage

ISMG 实例方法

- `ismg.setHeartbeatTimeout(heartbeatTimeout)` - 设置心跳超时时间
  - `heartbeatTimeout` - 毫秒级心跳超时时间，默认为 `60 * 1000`
- `ismg.setTimeout(timeout)` - 设置请求客户端的超时时间
  - `timeout` - 毫秒级超时时间，默认为 `30 * 1000`
- `ismg.listen([port[, callback]])` - 启动服务监听连接
  - `port` - 监听端口，默认为 `7890`
  - `callback` - 服务启动成功回调方法
- `ismg.setAuthentication(authentication)` - 设置鉴权方法，用于计算 `CMPP_CONNECT_RESP` 需要的字段以及鉴权情况
  - `authentication` - 鉴权方法
    ```javascript
    // 支持返回一个 Promise
    async function authentication({
      Source_Addr,         /* 源地址，此处为 SP_Id，即 SP 的企业代码，（客户端提供） */
      AuthenticatorSource, /* 用于鉴别源地址（客户端提供） */
      Timestamp,           /* 格式: MMDDHHmmss（客户端提供） */
      Host,                /* 用于鉴定 IP 有效性（当前客户端） */
    }) {
      // DIY: calculate Status and AuthenicatorISMG

      // 要求的返回格式
      return {
        Status: 0,            // 连接状态, 数字表示
        AuthenicatorISMG: '', // ISMG 认证码，用于鉴别 ISMG。字符串表示
      };
    }
    ```
- `ismg.setPort(port)` - 设置监听端口
  - `port` - 监听端口，默认为 `7890`, 作为 `ismg.listen` 使用的端口默认值
