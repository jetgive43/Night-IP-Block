const fs = require("fs");
const csv = require("csv-parser");

let asnData = [];
let countryData = [];
const MAX_CACHE_SIZE = 100000;
const asnCache = new Array(MAX_CACHE_SIZE);
const countryCache = new Array(MAX_CACHE_SIZE);

const loadAsnData = () => {
  return new Promise((resolve, reject) => {
    fs.createReadStream("asn_ipv4.csv")
      .pipe(csv())
      .on("data", (row) => {
        asnData.push({
          start_ip: ipToLong(row.start_ip),
          end_ip: ipToLong(row.end_ip),
          asn: row.asn,
          name: row.name,
          domain: row.domain,
        });
      })
      .on("end", () => {
        console.log(`Loaded ASN data with ${asnData.length} entries.`);
        resolve();
      })
      .on("error", reject);
  });
};

const loadCountryData = () => {
  return new Promise((resolve, reject) => {
    fs.createReadStream("country_ipv4.csv")
      .pipe(csv())
      .on("data", (row) => {
        countryData.push({
          start_ip: ipToLong(row.start_ip),
          end_ip: ipToLong(row.end_ip),
          country: row.country,
          country_name: row.country_name,
          continent: row.continent,
          continent_name: row.continent_name,
        });
      })
      .on("end", () => {
        console.log(`Loaded country data with ${countryData.length} entries.`);
        resolve();
      })
      .on("error", reject);
  });
};

const ipToLong = (ip) => {
  return (
    ip
      .split(".")
      .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0
  );
};

const getCacheIndex = (ipLong) => {
  return ipLong % MAX_CACHE_SIZE;
};

const binarySearch = (arr, ipLong, cache) => {
  const cacheIndex = getCacheIndex(ipLong);
  if (
    cache[cacheIndex] &&
    cache[cacheIndex].start_ip <= ipLong &&
    cache[cacheIndex].end_ip >= ipLong
  ) {
    return cache[cacheIndex];
  }

  let left = 0;
  let right = arr.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const entry = arr[mid];

    if (ipLong >= entry.start_ip && ipLong <= entry.end_ip) {
      cache[cacheIndex] = entry;
      return entry;
    }

    if (ipLong < entry.start_ip) {
      right = mid - 1;
    } else {
      left = mid + 1;
    }
  }

  return null;
};

const lookupIpToAsn = (ip) => {
  const ipLong = ipToLong(ip);
  const result = binarySearch(asnData, ipLong, asnCache);
  if (result) {
    return result.asn;
  }
  return null;
};

const lookupAsnToCountry = (asn) => {
  const result = asnData.find((entry) => entry.asn === asn);
  if (result) {
    const ipLong = result.start_ip;
    const countryResult = binarySearch(countryData, ipLong, asnCache);
    if (countryResult) {
      return countryResult.country;
    }
  }
  return null;
};

const lookupIpToCountry = (ip) => {
  const ipLong = ipToLong(ip);
  const result = binarySearch(countryData, ipLong, countryCache);
  if (result) {
    return result.country;
  }
  return null;
};

const initialize = async () => {
  await loadAsnData();
  await loadCountryData();
};

initialize()
  .then(() => {
    console.log("Data loaded successfully. Ready for lookups.");
  })
  .catch((error) => {
    console.error("Error loading data:", error);
  });

module.exports = {
  lookupIpToAsn,
  lookupAsnToCountry,
  lookupIpToCountry,
};
