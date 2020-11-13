
/**
 * {@link http://bluebirdjs.com/docs/api/deferred-migration.html | Deferred migration}
 */
exports.defer = function defer() {
  var resolve, reject;
  var promise = new Promise(function() {
      resolve = arguments[0];
      reject = arguments[1];
  });
  return {
      resolve: resolve,
      reject: reject,
      promise: promise
  };
}
/**
 * AuthenticatorSource = MD5(Source_Addr + 9 字节的 0 + shared secret + timestamp)
 * @param {*} Source_Addr
 * @param {*} secret
 * @param {*} timestamp
 */
exports.getAuthenticatorSource = (Source_Addr, secret, timestamp) => {
  const buffers = []
  buffers.push(Buffer.from(spId, 'ascii'));
  buffers.push(Buffer.alloc(9, 0));
  buffers.push(Buffer.from(secret, 'ascii'));
  buffers.push(Buffer.from(timestamp, 'ascii'));
  const buffer = Buffer.concat(buffers);

  return require('crypto').createHash('md5').update(buffer).digest();
}
