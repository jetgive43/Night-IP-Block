// Test file for IP lookup and status functionality
const { lookupIP} = require('./fetchAndCacheIP');
const axios = require('axios');
const ip2long = require('./utils').ip2long;
// Test IPs - you can modify these to test different IPs
const testIPs = [
  "83.59.57.145"
];

(async () => {
  for (const ip of testIPs) {
    try {
      const result = await lookupIP(ip);
      console.log(`\nIP: ${ip}`);
      console.log(ip2long(ip));
      console.log(result);
    } catch (err) {
      console.error(`Error looking up ${ip}:`, err.message);
    }
  }
})();