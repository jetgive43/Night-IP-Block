// Test file to demonstrate IP conversion issues
const axios = require('axios');

function ipToIntOriginal(ip) {
  console.log(ip)
  const parts = ip.split(".");
  return (
    parseInt(parts[0]) * 256 * 256 * 256 +
    parseInt(parts[1]) * 256 * 256 +
    parseInt(parts[2]) * 256 +
    parseInt(parts[3])
  );
}

function ipToIntFixed(ip) {
  const parts = ip.split(".");
  return (
    (parseInt(parts[0]) << 24) +
    (parseInt(parts[1]) << 16) +
    (parseInt(parts[2]) << 8) +
    parseInt(parts[3])
  ) >>> 0; // Use unsigned right shift to ensure positive result
}

function ipToIntAlternative(ip) {
  const parts = ip.split(".");
  return parts.reduce((acc, octet, index) => {
    return acc + (parseInt(octet) * Math.pow(256, 3 - index));
  }, 0);
}

// Test cases
const testIPs = [
  "213.183.59.56",
  "185.140.14.222",
  "185.140.14.243"
];

async function processNodeLogs(ipAddress) {
  try {
    console.log('ipToIntOriginal(ipAddress)');
    console.log(ipToIntOriginal(ipAddress));
    const logUrl = `http://${ipAddress}:29876/redirect${ipToIntOriginal(ipAddress)}.log`;
    console.log(`Processing logs from ${ipAddress}: ${logUrl}`);
    
    const response = await axios.get(logUrl, { timeout: 10000 });
    const logContent = response.data;
    console.log(logContent)
    
    if (!logContent) {
      console.log(`No log content from ${ipAddress}`);
      return;
    }

    const logLines = logContent.split('\n').filter(line => line.trim());
    
    if (logLines.length === 0) {
      console.log(`No log lines from ${ipAddress}`);
      return;
    }


  } catch (error) {
    console.error(`Error processing logs from ${ipAddress}:`, error.message);
  }
}


testIPs.forEach(ip => {
  processNodeLogs(ip);
});

