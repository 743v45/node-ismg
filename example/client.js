const Client = require('cmpp');

const host = '127.0.0.1';
const port = 7890;
const serviceId = ''; // 业务编号
const srcId = '10691069';
const SourceAddr = '200300';
const SharedSecret = 'password';

const client = new Client({
  host,
  port,
  serviceId,
  srcId,
  heartbeatInterval: 30 * 1000,
  heartbeatTimeout: 20 * 1000,
  timeout: 10 * 1000,
  mobilesPerSecond: 200,
});

client.on('receive', (mobile, content, body = {}) => {
  console.log(mobile, content, body);
});

client.on('deliver', (res) => {
  console.log(res);
});

client.connect(SourceAddr, SharedSecret);
