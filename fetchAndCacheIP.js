const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 3600 }); 
/**
 * Fetches and caches block data from the API
 */

async function fetchAndCacheBlockData() {
    try {
        axios.get('http://blocking.middlewaresv.xyz/api/blockedip/all').then(response => {
            const blockData = response.data;     
            // Prepare a sorted array for binary search
            const sortedData = blockData.map(block => ({
                start: parseInt(block.startip),
                end: parseInt(block.endip),
                isBlocked: block.isBlocked,
                countryCode: block.countryCode
            }));
            
            // Sort by start IP
            sortedData.sort((a, b) => a.start - b.start);
            
            // Store in cache
            cache.set('block_data', sortedData);
            
            return sortedData;
        }).catch(error => {
            console.error('Error fetching block data:', error.message);
            return null;
        })
    } catch (error) {
        console.error('Error fetching block data:', error.message);
        return null;
    }
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
        // Get cached data or fetch new data
        let blockData = cache.get('block_data');
        if (!blockData) {
            console.log('Cache miss, fetching fresh data...');
            blockData = await fetchAndCacheBlockData();
            if (!blockData) {
                throw new Error('Failed to fetch block data');
            }
        }
        
        const hash = ip2long(ip);
        const searchResult = binarySearch(blockData, hash);
        // filter block_status  != 0
        return searchResult;
    } catch (error) {
        console.error('Error in IP lookup:', error.message);
        return {
            blockStatus: 2,
            countryCode: "xx",
            error: error.message
        };
    }
}

// Example usage
async function main() {
    // Check if IP is provided as command line argument
    const ip = process.argv[2];
    
    if (!ip) {
        console.log('Usage: node fetchAndCacheIp.js <IP_ADDRESS>');
        console.log('Example: node fetchAndCacheIp.js 192.168.1.1');
        return;
    }
    
    const result = await lookupIP(ip);
}

// Export functions for use in other modules
module.exports = {
    fetchAndCacheBlockData,
    binarySearch,
    ip2long,
    lookupIP,
    cache
};

// Run main function if this file is executed directly
if (require.main === module) {
    main().catch(console.error);
} 