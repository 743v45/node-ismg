const ISMG = require('../index').Ismg;
const port = 7890;

const ismg = new ISMG();

ismg.setTimeout(30 * 1000);
ismg.setHeartbeatTimeout(60 * 1000);
ismg.setAuthentication(async () => {
  return {
    Status: 0,
    AuthenicatorISMG: '',
  }
});

ismg.listen(port,  () => {
  console.log(new Date() + ` Server is listening on port ${port}`);
});
