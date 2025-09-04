const axios = require('axios');
const { lookupIP } = require('./fetchAndCacheIP');
const { lookupIpToAsn, lookupIpToCountry } = require('./ipLookup');
const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
const { isInNightTimeRange } = require('./utils'); // Add this import

class LogProcessor {
  constructor() {
    this.processedLines = new Set();
    this.lastProcessedTimestamps = {};
  }

  async processCategory9Logs() {
    try {
      console.log('Starting category 9 log processing...');
      const nodes = await this.fetchNodes();
      const category9Nodes = nodes.filter(node => node.category === 9);     
      const category9NodesWithCountries = category9Nodes.map(node => {
        const country = lookupIpToCountry(node.ip) || 'Unknown';
        return {
          ...node,
          country: country
        };
      }).filter(node => {
        const shouldProcess = isInNightTimeRange(node.country);
        return shouldProcess;
      });
      console.log(category9NodesWithCountries);
      console.log(`Found ${category9NodesWithCountries.length} nodes in night time range to process`);
            
      for (const node of category9NodesWithCountries) {
        console.log(`\n--- Processing node: ${node.ip} (${node.country}) ---`);
        await this.processNodeLogs(node.ip);
      }      
      console.log('Category 9 log processing completed');
    } catch (error) {
      console.error('Error in category 9 log processing:', error);
    }
  }

  async fetchNodes() {
    try {
      const response = await axios.get('https://slave.host-palace.net/portugal_cdn/get_node_list');
      return response.data;
    } catch (error) {
      // console.error('Error fetching nodes:', error);
      return [];
    }
  }

  async processNodeLogs(ipAddress) {
    try {
      const calculatedInt = this.ipToInt(ipAddress);
      const logUrl = `http://${ipAddress}:29876/redirect${calculatedInt}.log`;
      try {
        axios.get(logUrl,{timeout: 10000}).then(async response => {
          const logContent = response.data;   
          if (!logContent) {
            return;
          }
          const logLines = logContent.split('\n').filter(line => line.trim());
          if (logLines.length === 0) {
            return;
          }
          const lastTimestamp = this.lastProcessedTimestamps[ipAddress] || 0;
          const newLines = [];
          for (const line of logLines) {
            const parsedLine = this.parseLogLine(line);
            if (parsedLine && parsedLine.timestamp > lastTimestamp) {
              newLines.push(parsedLine);
            }
          }

          if (newLines.length > 0) {
            await this.saveLogEntries(newLines);
            if (newLines.length > 0) {
              this.lastProcessedTimestamps[ipAddress] = Math.max(...newLines.map(l => l.timestamp));
            }
          }
        }).catch(error => {
          console.log(error)
        })
        console.log(`Processing logs from ${ipAddress}: ${logUrl}`);
        

      } catch (axiosError) {
        if (axiosError.response) {
          console.error(`HTTP Error for ${ipAddress}: Status ${axiosError.response.status} - ${axiosError.response.statusText}`);
          console.error(`Failed URL: ${logUrl}`);
        } else if (axiosError.request) {
          console.error(`Network Error for ${ipAddress}: No response received`);
          console.error(`Failed URL: ${logUrl}`);
        } else {
          console.error(`Error for ${ipAddress}:`, axiosError.message);
        }
        throw axiosError;
      }

    } catch (error) {
      console.error(`Error processing logs from ${ipAddress}:`, error.message);
    }
  }

  parseLogLine(line) {
    const parts = line.split('**');
    if (parts.length < 6) return null;

    const ipAddress = parts[0];
    const timestampStr = parts[1].slice(1, -1); // Remove brackets
    const domain = parts[2];
    const requestInfo = parts[3];
    const statusCode = parseInt(parts[4]);
    const responseTime = parseFloat(parts[5]);
    const userAgent = parts[6] || '';

    // Parse timestamp
    const timestamp = this.parseTimestamp(timestampStr);
    if (!timestamp) return null;

    // Parse request method and path
    const requestParts = requestInfo.split(' ');
    const requestMethod = requestParts[0] || '';
    const requestPath = requestParts.slice(1).join(' ') || '';

    return {
      ip: ipAddress,
      timestamp: timestamp,
      domain: domain,
      requestMethod: requestMethod,
      requestPath: requestPath,
      statusCode: statusCode,
      responseTime: responseTime,
      userAgent: userAgent,
      rawLine: line
    };
  }

  parseTimestamp(timestampStr) {
    try {
      // Handle your format: 04/Sep/2025:16:46:01 +0000
      const match = timestampStr.match(/(\d+)\/(\w+)\/(\d+):(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4})/);
      
      if (!match) {
        console.error('Could not parse timestamp:', timestampStr);
        return null;
      }
      
      const [, day, month, year, hour, minute, second, timezone] = match;
      
      // Convert month name to number
      const monthNames = {
        'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
        'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
      };
      
      const monthNum = monthNames[month];
      if (monthNum === undefined) {
        console.error('Invalid month:', month);
        return null;
      }
      
      // Create date object (this will be in UTC)
      const date = new Date(Date.UTC(
        parseInt(year),
        monthNum,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        parseInt(second)
      ));
      
      if (isNaN(date.getTime())) {
        console.error('Invalid date created from:', timestampStr);
        return null;
      }
      
      // Convert to Japan timezone
      const japanTime = new Date(date.toLocaleString("en-US", {timeZone: "Asia/Hong_Kong"}));      
      // Check if it's in night time range (2-5 AM Japan time)
      return Math.floor(japanTime.getTime() / 1000);
      const japanHour = japanTime.getHours();
      if (japanHour >= 2 && japanHour <= 5) {
      } else {
        return null;
      }
    } catch (error) {
      console.error('Error parsing timestamp:', timestampStr, error);
      return null;
    }
  }
  async saveLogEntries(logEntries) {
    if (logEntries.length === 0) return;
    const blockedLogEntries = [];
    
    for (const entry of logEntries) {
      try {
        const blockInfo = await lookupIP(entry.ip);
        const blockedCountries = ['xx', 'ww'];
        if (blockInfo.blockStatus === 0) {
          if (!blockedCountries.includes(blockInfo.countryCode)) {
            blockedLogEntries.push(entry);
          }
        } else {
          // console.log(`Skipping IP ${entry.ip} - not blocked (status: ${blockInfo.blockStatus})`);
        }
      } catch (error) {
        console.error(`Error checking block status for IP ${entry.ip}:`, error);
      }
    }

    if (blockedLogEntries.length === 0) {
      console.log('No blocked IPs found in log entries');
      return;
    }

    const connection = await connectToDatabase();
    try {
      // Insert log entries (only for blocked IPs) - store as Japan timezone
      const logValues = blockedLogEntries.map(entry => {
        // Convert Unix timestamp to Japan timezone string for MySQL
        const japanTime = new Date(entry.timestamp * 1000).toLocaleString("sv-SE", {timeZone: "America/Toronto"});
        return `('${entry.ip}', '${japanTime}', '${entry.domain}', '${entry.requestMethod}', '${entry.requestPath}', ${entry.statusCode}, ${entry.responseTime}, '${entry.userAgent.replace(/'/g, "''")}')`;
      }).join(', ');

      const insertLogQuery = `
        INSERT INTO log_entries (ip, timestamp, domain, request_method, request_path, status_code, response_time, user_agent)
        VALUES ${logValues}
        ON DUPLICATE KEY UPDATE
          timestamp = VALUES(timestamp),
          domain = VALUES(domain),
          request_method = VALUES(request_method),
          request_path = VALUES(request_path),
          status_code = VALUES(status_code),
          response_time = VALUES(response_time),
          user_agent = VALUES(user_agent)
      `;

      await runSqlQuery(connection, insertLogQuery);

      // Process IPs for blocking (only blocked IPs)
      await this.processIPsForBlocking(blockedLogEntries, connection);

      console.log(`Saved ${blockedLogEntries.length} log entries (filtered from ${logEntries.length} total entries) in Japan timezone`);
    } catch (error) {
      console.error('Error saving log entries:', error);
    } finally {
      await disconnectFromDatabase(connection);
    }
  }

  async processIPsForBlocking(logEntries, connection) {
    try {
      // Count occurrences of each IP in this batch
      const ipCounts = {};
      for (const entry of logEntries) {
        ipCounts[entry.ip] = (ipCounts[entry.ip] || 0) + 1;
      }

      for (const [ip, count] of Object.entries(ipCounts)) {
        const existingIP = await this.getExistingIP(connection, ip);
        if (!existingIP) {
          const ipInfo = await this.getIPInfo(ip);
          await this.insertIPRecord(connection, ip, ipInfo, count);
        } else {
          await this.updateIPRequestCount(connection, ip, count);
        }
      }

      await this.updateStatistics(connection);
    } catch (error) {
      console.error('Error processing IPs for blocking:', error);
    }
  }

  async getExistingIP(connection, ip) {
    try {
      const query = 'SELECT * FROM blocked_ips WHERE ip = ?';
      const results = await runSqlQuery(connection, query, [ip]);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      console.error('Error getting existing IP:', error);
      return null;
    }
  }

  async getIPInfo(ip) {
    try {
      // Get blocking status from cache
      const blockInfo = await lookupIP(ip);
      
      // Get ASN and country
      const asn = lookupIpToAsn(ip) || 'Unknown';
      const country = lookupIpToCountry(ip) || 'xx';
      
      return {
        isBlocked: blockInfo.blockStatus === 0 ? 0 : 1,
        countryCode: blockInfo.countryCode || country,
        asn: asn
      };
    } catch (error) {
      console.error('Error getting IP info:', error);
      return {
        isBlocked: 0,
        countryCode: 'xx',
        asn: 'Unknown'
      };
    }
  }

  async insertIPRecord(connection, ip, ipInfo, count = 1) {
    const query = `
      INSERT INTO blocked_ips (ip, country_code, asn, is_blocked, request_count)
      VALUES (?, ?, ?, ?, ?)
    `;
    await runSqlQuery(connection, query, [ip, ipInfo.countryCode, ipInfo.asn, ipInfo.isBlocked, count]);
  }

  async updateIPRequestCount(connection, ip, count = 1) {
    const query = `
      UPDATE blocked_ips
      SET request_count = request_count + ?, last_seen = CURRENT_TIMESTAMP
      WHERE ip = ?
    `;
    await runSqlQuery(connection, query, [count, ip]);
  }


  async updateStatistics(connection) {
    try {
      // Update country statistics
      const countryQuery = `
        INSERT INTO country_stats (country_code, total_blocked_ips)
        SELECT country_code, COUNT(*) as total
        FROM blocked_ips
        WHERE is_blocked = 0
        GROUP BY country_code
        ON DUPLICATE KEY UPDATE
          total_blocked_ips = VALUES(total_blocked_ips)
      `;
      await runSqlQuery(connection, countryQuery);

      // Update ASN statistics
      const asnQuery = `
        INSERT INTO asn_stats (asn, country_code, total_blocked_ips)
        SELECT asn, country_code, COUNT(*) as total
        FROM blocked_ips
        WHERE is_blocked = 0
        GROUP BY asn, country_code
        ON DUPLICATE KEY UPDATE
          total_blocked_ips = VALUES(total_blocked_ips)
      `;
      await runSqlQuery(connection, asnQuery);
    } catch (error) {
      console.error('Error updating statistics:', error);
    }
  }

  async cleanOldLogs() {
    try {
      const connection = await connectToDatabase();
      
      // Remove logs older than 5 minutes (in Japan timezone)
      const fiveMinutesAgo = new Date(Date.now() - (5 * 60 * 1000));
      const japanTime = fiveMinutesAgo.toLocaleString("en-US", {timeZone: "Asia/Tokyo"});
      
      const query = 'DELETE FROM log_entries WHERE timestamp < ?';
      await runSqlQuery(connection, query, [japanTime]);
      
      await disconnectFromDatabase(connection);
      console.log('Cleaned old logs (using Japan timezone)');
    } catch (error) {
      console.error('Error cleaning old logs:', error);
    }
  }
  ipToInt(ip) {
    const parts = ip.split(".");
    return (
      parseInt(parts[0]) * 256 * 256 * 256 +
      parseInt(parts[1]) * 256 * 256 +
      parseInt(parts[2]) * 256 +
      parseInt(parts[3])
    );
  }
}

module.exports = LogProcessor; 