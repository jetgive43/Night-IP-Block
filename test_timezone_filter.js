const LogProcessor = require('./logProcessor');

// Test the timezone parsing and filtering
function testTimezoneFiltering() {
  const processor = new LogProcessor();
  
  // Test timestamps in different timezones
  const testTimestamps = [
    '30/Aug/2025:02:30:01 +0200',  // 2:30 AM +0200 (should pass - 2 AM)
    '30/Aug/2025:04:32:13 +0200',  // 4:32 AM +0200 (should pass - between 2-5 PM)
    '30/Aug/2025:12:30:01 +0200',  // 12:30 PM +0200 (should pass - between 2-5 PM)
    '30/Aug/2025:16:45:01 +0200',  // 4:45 PM +0200 (should pass - 5 PM)
    '30/Aug/2025:01:30:01 +0200',  // 1:30 AM +0200 (should fail - before 2 AM)
    '30/Aug/2025:18:30:01 +0200',  // 6:30 PM +0200 (should fail - after 5 PM)
    '30/Aug/2025:02:30:01 -0500',  // 2:30 AM -0500 (should pass - 2 AM)
    '30/Aug/2025:16:45:01 -0500',  // 4:45 PM -0500 (should pass - 5 PM)
    '30/Aug/2025:01:30:01 -0500',  // 1:30 AM -0500 (should fail - before 2 AM)
    '30/Aug/2025:18:30:01 -0500',  // 6:30 PM -0500 (should fail - after 5 PM)
  ];

  console.log('Testing timezone parsing and filtering (2 AM - 5 PM)...\n');

  testTimestamps.forEach((timestamp, index) => {
    console.log(`Test ${index + 1}: ${timestamp}`);
    
    try {
      const parsed = processor.parseTimestamp(timestamp);
      if (parsed) {
        const isInRange = processor.isBetween2AMAnd5PM(parsed);
        const localTime = parsed.localDate.toLocaleTimeString();
        console.log(`  Parsed: ${localTime} (Timezone offset: ${parsed.timezoneOffset} minutes)`);
        console.log(`  Local hour: ${parsed.localHour}`);
        console.log(`  Between 2 AM - 5 PM: ${isInRange ? 'YES' : 'NO'}`);
      } else {
        console.log(`  Failed to parse timestamp`);
      }
    } catch (error) {
      console.log(`  Error: ${error.message}`);
    }
    console.log('');
  });
}

// Test with a sample log line
function testLogLineParsing() {
  const processor = new LogProcessor();
  
  const testLogLines = [
    '192.168.1.1**[30/Aug/2025:04:32:13 +0200]**example.com**GET /test**200**0.123**Mozilla/5.0',
    '192.168.1.2**[30/Aug/2025:01:30:01 +0200]**example.com**GET /test**200**0.123**Mozilla/5.0',
    '192.168.1.3**[30/Aug/2025:18:30:01 +0200]**example.com**GET /test**200**0.123**Mozilla/5.0'
  ];
  
  console.log('Testing log line parsing...\n');
  
  testLogLines.forEach((logLine, index) => {
    console.log(`Log line ${index + 1}: ${logLine}\n`);
    
    try {
      const parsed = processor.parseLogLine(logLine);
      if (parsed) {
        console.log('Log parsed successfully:');
        console.log(`  IP: ${parsed.ip}`);
        console.log(`  Timestamp: ${parsed.timestamp}`);
        console.log(`  Domain: ${parsed.domain}`);
        console.log(`  Method: ${parsed.requestMethod}`);
        console.log(`  Path: ${parsed.requestPath}`);
        console.log(`  Status: ${parsed.statusCode}`);
        console.log(`  Response Time: ${parsed.responseTime}`);
        console.log(`  User Agent: ${parsed.userAgent}`);
      } else {
        console.log('Log was filtered out (outside 2 AM - 5 PM timezone)');
      }
    } catch (error) {
      console.log(`Error parsing log line: ${error.message}`);
    }
    console.log('---');
  });
}

// Run tests
if (require.main === module) {
  testTimezoneFiltering();
  console.log('='.repeat(50));
  testLogLineParsing();
} 