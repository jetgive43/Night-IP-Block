// Test file for IP lookup and status functionality
const { lookupIP} = require('./fetchAndCacheIP');
const axios = require('axios');

// Test IPs - you can modify these to test different IPs
const testIPs = [
  "109.51.65.65"
];

(async () => {
  for (const ip of testIPs) {
    try {
      const result = await lookupIP(ip);
      console.log(`\nIP: ${ip}`);
      console.log(result);
    } catch (err) {
      console.error(`Error looking up ${ip}:`, err.message);
    }
  }
})();