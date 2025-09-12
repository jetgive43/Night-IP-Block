const axios = require('axios');
let blockDataCache = null;
let lastFetchTime = 0;
let userDomainListCache = null;
let isDomainListFetched = false; // Add this flag
const CACHE_DURATION = 3600000; // 1 hour in milliseconds

async function fetchBlockData() {
    try {
        const response = await axios.get('http://blocking.middlewaresv.xyz/api/blockedip/all', {
            timeout: 10000
        });
        
        const blockData = response.data;        
        const sortedData = blockData.map(block => ({
            start: parseInt(block.startip),
            end: parseInt(block.endip),
            isBlocked: block.isBlocked,
            countryCode: block.countryCode
        }));
        sortedData.sort((a, b) => a.start - b.start);
        return sortedData;
    } catch (error) {
        return null;
    }
}
async function fetchUserDomainList() {    
    try
    {
        const response = await axios.get('https://slave.host-palace.net/user_domain_list', {
            timeout: 10000
        });
        const userDomainList = response.data;
        const filteredData = userDomainList.map(user => ({
            domain: user.domain.replace('*.', ''),
            username: user.username,
            backnode: user.backnode,
            region: user.region
        }));
        return filteredData;
    } catch (error) {
        console.error('Error fetching user domain list:', error.message);
        if (error.response) {
            console.error(`HTTP Status: ${error.response.status}`);
        }
        return null;
    }
    return response.data;
}
async function getUserDomainList() {
    if (isDomainListFetched && userDomainListCache) {
        return userDomainListCache;
    }
    
    console.log("fetching user domain list (one time only)");
    const freshData = await fetchUserDomainList();
    if (freshData) {
        userDomainListCache = freshData;
        isDomainListFetched = true; // Mark as fetched
    }
    return freshData;
}
async function initializeUserDomainList() {
    try {
        console.log("Initializing user domain list...");
        const data = await fetchUserDomainList();
        if (data) {
            userDomainListCache = data;
            isDomainListFetched = true;
            console.log(`User domain list initialized with ${data.length} entries`);
        } else {
            console.error("Failed to initialize user domain list");
        }
    } catch (error) {
        console.error("Error initializing user domain list:", error);
    }
}
function getUserDomainList() {
    if (!isDomainListFetched || !userDomainListCache) {
        console.warn("User domain list not initialized. Call initializeUserDomainList() first.");
        return null;
    }
    return userDomainListCache;
}

function getUserNameFromDomain(domain) {
    const userDomainList = getUserDomainList();
    if (!userDomainList) {
        return null;
    }
    const user = userDomainList.find(user => domain.includes(user.domain));
    return user ? user.username : null;
}
async function getBlockData() {
    const now = Date.now();
    if (blockDataCache && (now - lastFetchTime) < CACHE_DURATION) {
        return blockDataCache;
    }
    const freshData = await fetchBlockData();
    
    if (freshData) {
        blockDataCache = freshData;
        lastFetchTime = now;
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
    testLookup,
    getUserNameFromDomain,
    initializeUserDomainList, // Add this export
    getUserDomainList
};
// Run main function if this file is executed directly
if (require.main === module) {
    if (process.argv[2] === 'test') {
        testLookup().catch(console.error);
    } else {
        main().catch(console.error);
    }
} 