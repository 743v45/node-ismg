const ISMG = require('../index').Ismg;
const port = 7890;
const Netmask = require('netmask').Netmask;

const ismg = new ISMG();

ismg.setTimeout(30 * 1000);
ismg.setHeartbeatTimeout(60 * 1000);
ismg.setAuthentication(authentication);


ismg.listen(port,  () => {
  console.log(new Date() + ` Server is listening on port ${port}`);
});

async function findBySpIdAsync(sp_id) {
  return {
    secret: 'password',
    ipWhiteList: '127.0.0.1/32;',
  };
}

/**
 *
 * @param {object} param0
 * @param {string} param0.Source_Addr
 * @param {Buffer} param0.AuthenticatorSource
 * @param {number} param0.Timestamp
 * @param {string} param0.remoteAddress
 */
async function authentication({Source_Addr: spId, AuthenticatorSource, Timestamp, remoteAddress}) {
  const user = await findBySpIdAsync(spId);
  if (!user) {
    return {
      Status: 3,
      AuthenicatorISMG: '',
    };
  }
  const {secret, ipWhiteList} = user;

  // ip 白名单
  if (ipWhiteList) {
    let Status = 2;
    const ipWhiteLists = ipWhiteList.split(';');

    for (let i = 0; i < ipWhiteLists.length; i++) {
      const v = ipWhiteLists[i];
      try {
        if (new Netmask(v).contains(remoteAddress)) {
          Status = 0;
        }
      } catch (e) {
      }

      if (Status === 0) break;
    }
    if (Status !== 0) {
      return {
        Status: Status,
        AuthenicatorISMG: '',
      };
    }
  }

  const buffers = []

  buffers.push(Buffer.from(spId, 'ascii'));
  buffers.push(Buffer.alloc(9, 0));
  buffers.push(Buffer.from(secret, 'ascii'));
  buffers.push(Buffer.from(String(Timestamp), 'ascii'));
  const buffer = Buffer.concat(buffers);

  if (require('crypto').createHash('md5').update(buffer).digest().compare(AuthenticatorSource) !== 0) {
    return {
      Status: 3,
      AuthenicatorISMG: '',
    };
  }

  // todo: connections is too much.

  return {
    Status: 0,
    AuthenicatorISMG: '',
  }
}
