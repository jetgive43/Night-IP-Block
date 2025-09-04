const axios = require('axios');

// Simple in-memory cache
let blockDataCache = null;
let lastFetchTime = 0;
const CACHE_DURATION = 3600000; // 1 hour in milliseconds

/**
 * Fetches block data from the API
 */
async function fetchBlockData() {
    try {
        console.log('Fetching block data from API...');
        const response = await axios.get('http://blocking.middlewaresv.xyz/api/blockedip/all', {
            timeout: 10000
        });
        
        const blockData = response.data;
        console.log(`Received ${blockData.length} IP ranges from API`);
        
        const sortedData = blockData.map(block => ({
            start: parseInt(block.startip),
            end: parseInt(block.endip),
            isBlocked: block.isBlocked,
            countryCode: block.countryCode
        }));
        
        sortedData.sort((a, b) => a.start - b.start);
        console.log('Block data processed and sorted');
        
        return sortedData;
    } catch (error) {
        console.error('Error fetching block data:', error.message);
        if (error.response) {
            console.error(`HTTP Status: ${error.response.status}`);
        }
        return null;
    }
}

/**
 * Gets block data (from cache or API)
 */
async function getBlockData() {
    const now = Date.now();
    
    // Check if we have valid cached data
    if (blockDataCache && (now - lastFetchTime) < CACHE_DURATION) {
        // console.log(`Using cached data (${blockDataCache.length} ranges, age: ${Math.round((now - lastFetchTime) / 1000)}s)`);
        return blockDataCache;
    }
    
    // Fetch new data
    console.log('Cache expired or empty, fetching fresh data...');
    const freshData = await fetchBlockData();
    
    if (freshData) {
        blockDataCache = freshData;
        lastFetchTime = now;
        console.log('Data cached successfully');
    }
    
    return freshData;
}

/**
 * Binary search function to find IP in block data
 */
function binarySearch(data, ip) {
    let low = 0;
    let high = data.length - 1;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);

        if (ip < data[mid].start) {
            high = mid - 1;
        } else if (ip > data[mid].end) {
            low = mid + 1;
        } else {
            console.log(data[mid])
            return {
                blockStatus: data[mid].isBlocked,
                countryCode: (data[mid].countryCode === null || data[mid].countryCode === "") ? "xx" : data[mid].countryCode
            };
        }
    }

    return {
        blockStatus: 2, // Not found, meaning not blocked
        countryCode: "xx" // No country code for unmatched IP
    };
}

/**
 * Convert IP address to long integer
 */
function ip2long(ip) {
    const parts = ip.split('.');
    return (parseInt(parts[0]) << 24) + 
           (parseInt(parts[1]) << 16) + 
           (parseInt(parts[2]) << 8) + 
           parseInt(parts[3]);
}

/**
 * Main function to lookup IP
 */
async function lookupIP(ip) {
    try {
        const blockData = await getBlockData();
        
        if (!blockData) {
            console.error('No block data available');
            return {
                blockStatus: 2,
                countryCode: "xx",
                error: "No block data available"
            };
        }
        
        const hash = ip2long(ip);
        const searchResult = binarySearch(blockData, hash);
        return searchResult;
    } catch (error) {
        console.error(`Error in lookupIP for ${ip}:`, error.message);
        return {
            blockStatus: 2,
            countryCode: "xx",
            error: error.message
        };
    }
}

// Test function
async function testLookup() {
    const testIPs = [
        "89.163.144.62",
        "24.207.56.42", 
        "109.49.242.86",
        "73.197.203.61",
        "192.168.1.1"
    ];

    console.log('=== Testing IP Lookup ===\n');
    
    for (const ip of testIPs) {
        console.log(`\n--- Testing IP: ${ip} ---`);
        const result = await lookupIP(ip);
        console.log(`Block Status: ${result.blockStatus} (1=blocked, 0=not blocked, 2=not found)`);
        console.log(`Country: ${result.countryCode}`);
        console.log(`Should Log: ${result.blockStatus === 1 ? 'YES' : 'NO'}`);
    }
}

// Example usage
async function main() {
    const ip = process.argv[2];
    
    if (!ip) {
        console.log('Usage: node fetchAndCacheIp.js <IP_ADDRESS>');
        console.log('Example: node fetchAndCacheIp.js 192.168.1.1');
        return;
    }
    
    const result = await lookupIP(ip);
    console.log('Final result:', result);
}

// testLookup();
// Export functions for use in other modules
module.exports = {
    fetchBlockData,
    getBlockData,
    binarySearch,
    ip2long,
    lookupIP,
    testLookup
};
// Run main function if this file is executed directly
if (require.main === module) {
    if (process.argv[2] === 'test') {
        testLookup().catch(console.error);
    } else {
        main().catch(console.error);
    }
} 