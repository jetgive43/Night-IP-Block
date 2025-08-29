const axios = require("axios");
const {
  runSqlQuery,
  connectToDatabase,
  disconnectFromDatabase,
} = require("./database");
const { createDateFromString } = require("./utils");
const { lookupIpToAsn } = require("./ipLookup");
const pLimit = require("p-limit");
const cron = require("node-cron");

url = "http://slave.host-palace.net/portugal_cdn/get_node_list";

const limit = pLimit(50);

const lastTimeStamps = {};

async function fetchData() {
  try {
    const response = await axios.get(url);
    const data = response.data;

    return data;
  } catch (error) {
    console.error("Error fetching data:", error);
    return [];
  }
}

function ipToInt(ip) {
  const parts = ip.split(".");
  return (
    parseInt(parts[0]) * 256 * 256 * 256 +
    parseInt(parts[1]) * 256 * 256 +
    parseInt(parts[2]) * 256 +
    parseInt(parts[3])
  );
}

async function readLogFile(ipAddress, category) {
  let ipCountTable = [];
  let domainCountTable = [];

  console.log("Reading ipAddres", ipAddress);
  console.log(ipToInt(ipAddress));
  try {
    let logUrl;
    if (category === 3 || category === 4) {
      logUrl = `http://${ipAddress}:29876/stream${ipToInt(ipAddress)}.log`;
    } else if (category === 8) {
      logUrl = `http://${ipAddress}:29876/block.log`;
    } else if (category === 9 || category === 10 || category === 11) {
      logUrl = `http://${ipAddress}:29876/redirect${ipToInt(ipAddress)}.log`;
    } else {
      return;
    }

    const response = await axios.get(logUrl);
    if (!response.data) {
      console.log(
        `Failed to fetch log content. Status code: ${response.status}, ${logUrl}`
      );
      return { ipCountTable: [], domainCountTable: [] };
      //   throw new Error(`HTTP error! status: ${response.status}`);
    }

    const logContent = await response.data;
    // console.log("log file fetched");
    const logLines = logContent.split("\n").filter((line) => line.trim());

    if (logLines.length === 0) return;

    const lasLogline = logLines[logLines.length - 3];

    let totalBytes = 0;

    logLines.forEach((line) => {
      const row = parseRow(line);
      if (row && row.domain) {
        if (row.timestamp < lastTimeStamps[ipAddress]) {
          return;
        }
        totalBytes += row.bytes;
        let ipEntry = ipCountTable.find(
          (entry) => entry.asn === row.asn && entry.timestamp === row.timestamp
        );
        if (ipEntry) {
          ipEntry.count++;
          ipEntry.bytes += row.bytes;
        } else {
          ipCountTable.push({
            asn: row.asn,
            timestamp: row.timestamp,
            count: 1,
            bytes: row.bytes,
          });
        }

        let domainEntry = domainCountTable.find(
          (entry) =>
            entry.domain === row.domain && entry.timestamp === row.timestamp
        );
        if (domainEntry) {
          domainEntry.count++;
          domainEntry.bytes += row.bytes;
        } else {
          domainCountTable.push({
            domain: row.domain,
            timestamp: row.timestamp,
            count: 1,
            bytes: row.bytes,
          });
        }
      }
    });

    if (lasLogline) {
      const row = parseRow(lasLogline);
      if (row) lastTimeStamps[ipAddress] = row.timestamp;
    }

    return { ipCountTable, domainCountTable, totalBytes };
  } catch (e) {
    console.log("Failed to fetch log content.");
    return { ipCountTable: [], domainCountTable: [] };
  }
}

function parseRow(row) {
  const parts = row.split("**");
  const ipAddress = parts[0];
  const timestamp = Math.floor(
    createDateFromString(parts[1].slice(1, -1)).getTime() / 1000
  );
  const domain = parts[2];
  const bytes = parseInt(parts[5]);

  const asn = lookupIpToAsn(ipAddress) ?? "No ASN";

  return {
    asn,
    timestamp,
    domain,
    bytes,
  };
}

async function keep10MinsData() {
  const connection = await connectToDatabase();
  try {
    // Remove rows older than 10 minutes for ip_counts table
    const removeOldIpCountsQuery = `
        DELETE FROM ip_counts
        WHERE timestamp < (
          SELECT MAX(timestamp) - 600
          FROM (SELECT timestamp FROM ip_counts) AS sub
        );
      `;
    await runSqlQuery(connection, removeOldIpCountsQuery);
    console.log("Removed old rows from ip_counts table");

    // Remove rows older than 10 minutes for domain_counts table
    const removeOldDomainCountsQuery = `
        DELETE FROM domain_counts
        WHERE timestamp < (
          SELECT MAX(timestamp) - 600
          FROM (SELECT timestamp FROM domain_counts) AS sub
        );
      `;
    await runSqlQuery(connection, removeOldDomainCountsQuery);
    console.log("Removed old rows from domain_counts table");

    disconnectFromDatabase(connection);
  } catch (e) {
    disconnectFromDatabase(connection);
    console.log(e);
  }
}

exports.runScript = async () => {
  const data = await fetchData();
  // const tempdata = [data[0]];
  console.log("Node length is", data.length);

  let readCount = 0;

  let successCount = 0;

  let totalIpValues = [];
  let totalDomainValues = [];

  let totalBandWidth = 0;

  let totalIpCountTable = [];
  let totalDomainCountTable = [];

  await Promise.all(
    data.map(async (element) =>
      limit(async () => {
        try {
          //   console.log(element.ip);
          const { ipCountTable, domainCountTable, totalBytes } =
            await readLogFile(element.ip, element.category);

          // console.log("Read completed!");

          ipCountTable.forEach((row) => {
            const ipEntry = totalIpCountTable.find(
              (item) =>
                item.asn === row.asn &&
                item.timestamp === row.timestamp &&
                item.category === element.category
            );

            if (ipEntry) {
              ipEntry.count = ipEntry.count + 1;
              ipEntry.bytes = ipEntry.bytes + row.bytes;
            } else {
              totalIpCountTable.push({
                asn: row.asn,
                timestamp: row.timestamp,
                count: 1,
                bytes: row.bytes,
                category: element.category,
              });
            }
          });

          domainCountTable.forEach((row) => {
            const domainEntry = totalDomainCountTable.find(
              (item) =>
                item.domain === row.domain &&
                item.timestamp === row.timestamp &&
                item.category === element.category
            );

            if (domainEntry) {
              domainEntry.count = domainEntry.count + 1;
              domainEntry.bytes = domainEntry.bytes + row.bytes;
            } else {
              totalDomainCountTable.push({
                domain: row.domain,
                timestamp: row.timestamp,
                count: 1,
                bytes: row.bytes,
                category: element.category,
              });
            }
          });

          // console.log("Process completed!");

          readCount++;
          if (ipCountTable.length === 0) return;
          successCount++;
          const ipValues = ipCountTable
            .map(
              ({ asn, timestamp, bytes, count }) =>
                `('${asn}', ${count}, ${bytes}, ${timestamp}, ${element.category})`
            )
            .join(", ");

          const domainValues = domainCountTable
            .map(
              ({ domain, timestamp, bytes, count }) =>
                `('${domain}', ${count}, ${bytes}, ${timestamp}, ${element.category})`
            )
            .join(", ");

          totalIpValues = [...totalIpValues, ipValues];
          totalDomainValues = [...totalDomainValues, domainValues];

          totalBandWidth += totalBytes;
          // totalDomainValues = [...totalDomainValues, ...domainValues];
        } catch (e) {
          // console.log("Failed to fetch log content.", e);
          return;
        }
      })
    )
  );

  const connection = await connectToDatabase();

  const totalIpCountQuery = totalIpCountTable
    .map(
      ({ asn, timestamp, bytes, count, category }) =>
        `('${asn}', ${count}, ${bytes}, ${timestamp}, ${category})`
    )
    .join(", ");

  const totalDomainCountQuery = totalDomainCountTable
    .map(
      ({ domain, timestamp, bytes, count, category }) =>
        `('${domain}', ${count}, ${bytes}, ${timestamp}, ${category})`
    )
    .join(", ");

  console.log("Start SQL writing!!!");

  if (totalIpCountTable.length > 0) {
    const insertQuery = `INSERT INTO ip_counts (asn, count, bytes, timestamp, category)
    VALUES ${totalIpCountQuery}
    ON DUPLICATE KEY UPDATE
      count = count + VALUES(count),
      bytes = VALUES(bytes),
      timestamp = VALUES(timestamp);`;
    await runSqlQuery(connection, insertQuery);
  }

  console.log("Done for IP count table");

  if (totalDomainCountQuery.length > 0) {
    const insertQuery = `INSERT INTO domain_counts (domain, count, bytes, timestamp, category)
    VALUES ${totalDomainCountQuery}
    ON DUPLICATE KEY UPDATE
      count = count + VALUES(count),
      bytes = VALUES(bytes),
      timestamp = VALUES(timestamp);`;
    await runSqlQuery(connection, insertQuery);
  }

  console.log("Done for Domain count table");

  // if (totalIpValues.length > 0) {
  //   const insertQuery = `INSERT INTO ip_counts (asn, count, bytes, timestamp, category)
  // VALUES ${totalIpValues.join(", ")}
  // ON DUPLICATE KEY UPDATE
  //   count = count + VALUES(count),
  //   bytes = VALUES(bytes),
  //   timestamp = VALUES(timestamp);`;
  //   await runSqlQuery(connection, insertQuery);
  // }

  // if (totalDomainValues.length > 0) {
  //   const insertQuery = `INSERT INTO domain_counts (domain, count, bytes, timestamp, category)
  // VALUES ${totalDomainValues.join(", ")}
  // ON DUPLICATE KEY UPDATE
  //   count = count + VALUES(count),
  //   bytes = VALUES(bytes),
  //   timestamp = VALUES(timestamp);`;
  //   await runSqlQuery(connection, insertQuery);
  // }

  disconnectFromDatabase(connection);

  console.log("total bandwidth: ", totalBandWidth / (1024 * 1024));

  await keep10MinsData();
  console.log("All Done!!!!!");
};

// this.runScript();
// cron.schedule("* * * * *", () => {
//   console.log("Running cron job...");
//   main();
// });
// main();

// console.log("Done");
