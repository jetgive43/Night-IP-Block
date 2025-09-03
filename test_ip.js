// Test file for IP lookup and status functionality
const { lookupIP, fetchAndCacheBlockData, ip2long, binarySearch } = require('./fetchAndCacheIP');
const axios = require('axios');

// Test IPs - you can modify these to test different IPs
const testIPs = [
  "213.183.59.56",
  "185.140.14.222", 
  "185.140.14.243",
  "8.8.8.8",        // Google DNS
  "1.1.1.1",        // Cloudflare DNS
  "192.168.1.1"     // Private IP
];

async function testAPIConnectivity() {
  console.log('=== Testing API Connectivity ===\n');
  
  const apiUrl = 'http://blocking.middlewaresv.xyz/api/blockedip/all';
  
  try {
    console.log(`Testing API endpoint: ${apiUrl}`);
    const response = await axios.get(apiUrl, { timeout: 10000 });
    
    console.log(`✅ API Response Status: ${response.status}`);
    console.log(`✅ Response Headers:`, response.headers);
    console.log(`✅ Data Type: ${typeof response.data}`);
    console.log(`✅ Data Length: ${Array.isArray(response.data) ? response.data.length : 'Not an array'}`);
    
    if (Array.isArray(response.data) && response.data.length > 0) {
      console.log('\nSample data structure:');
      console.log(JSON.stringify(response.data[0], null, 2));
    }
    
    return true;
  } catch (error) {
    console.log(`❌ API Error: ${error.message}`);
    if (error.response) {
      console.log(`   Status: ${error.response.status}`);
      console.log(`   Status Text: ${error.response.statusText}`);
    } else if (error.request) {
      console.log(`   Network Error: No response received`);
    }
    return false;
  }
}

async function testIPLookup() {
  console.log('\n=== Testing IP Lookup and Status Function ===\n');
  
  try {
    // First, fetch and cache the block data
    console.log('1. Fetching and caching block data...');
    const blockData = await fetchAndCacheBlockData();
    
    if (blockData) {
      console.log(`✅ Successfully cached ${blockData.length} IP ranges`);
      
      // Show some sample data
      console.log('\nSample block data (first 3 entries):');
      blockData.slice(0, 3).forEach((entry, index) => {
        console.log(`  ${index + 1}. Range: ${entry.start} - ${entry.end}, Blocked: ${entry.isBlocked}, Country: ${entry.countryCode}`);
      });
    } else {
      console.log('❌ Failed to fetch block data');
      return;
    }
    
    console.log('\n2. Testing IP lookups...\n');
    
    // Test each IP
    for (const ip of testIPs) {
      console.log(`Testing IP: ${ip}`);
      
      try {
        const result = await lookupIP(ip);
        
        console.log(`  IP Integer: ${ip2long(ip)}`);
        console.log(`  Block Status: ${result.blockStatus} (1=blocked, 0=not blocked, 2=not found)`);
        console.log(`  Country Code: ${result.countryCode}`);
        
        if (result.error) {
          console.log(`  Error: ${result.error}`);
        }
        
        // Determine if this IP should be logged based on your criteria
        const shouldLog = result.blockStatus === 1;
        console.log(`  Should Log: ${shouldLog ? '✅ YES' : '❌ NO'}`);
        
      } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
      }
      
      console.log(''); // Empty line for readability
    }
    
    console.log('=== Test Summary ===');
    console.log('Block Status Legend:');
    console.log('  1 = Blocked (should be logged)');
    console.log('  0 = Not blocked');
    console.log('  2 = Not found in cache (not blocked)');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Test binary search function directly
function testBinarySearch() {
  console.log('\n=== Testing Binary Search Function ===\n');
  
  // Create some test data
  const testData = [
    { start: 1000, end: 2000, isBlocked: 1, countryCode: 'US' },
    { start: 3000, end: 4000, isBlocked: 0, countryCode: 'CA' },
    { start: 5000, end: 6000, isBlocked: 1, countryCode: 'GB' }
  ];
  
  const testCases = [
    { ip: 1500, expected: 1, description: 'Should find blocked IP in first range' },
    { ip: 3500, expected: 0, description: 'Should find unblocked IP in second range' },
    { ip: 2500, expected: 2, description: 'Should not find IP between ranges' },
    { ip: 7000, expected: 2, description: 'Should not find IP after all ranges' }
  ];
  
  testCases.forEach(testCase => {
    const result = binarySearch(testData, testCase.ip);
    const passed = result.blockStatus === testCase.expected;
    console.log(`${passed ? '✅' : '❌'} ${testCase.description}`);
    console.log(`   IP: ${testCase.ip}, Expected: ${testCase.expected}, Got: ${result.blockStatus}`);
  });
}

// Run the tests
async function runAllTests() {
  const apiWorking = await testAPIConnectivity();
  if (apiWorking) {
    await testIPLookup();
  }
  testBinarySearch();
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = { testIPLookup, testBinarySearch, testAPIConnectivity };

