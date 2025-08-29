const axios = require('axios');
const { lookupIP } = require('./fetchAndCacheIP');
const { lookupIpToAsn, lookupIpToCountry } = require('./ipLookup');
const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');

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
      // Log all category 9 nodes for debugging
      category9Nodes.forEach((node, index) => {
        console.log(`Node ${index + 1}: IP=${node.ip}, Category=${node.category}`);
      });
      
      for (const node of category9Nodes) {
        console.log(`\n--- Processing node: ${node.ip} ---`);
        await this.processNodeLogs(node.ip);
      }
      await this.cleanOldLogs();
      
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
      console.error('Error fetching nodes:', error);
      return [];
    }
  }

  async processNodeLogs(ipAddress) {
    try {
      const calculatedInt = this.ipToInt(ipAddress);
      console.log(`IP: ${ipAddress}, Calculated int: ${calculatedInt}`);
      
      const logUrl = `http://${ipAddress}:29876/redirect${calculatedInt}.log`;
      console.log(`Processing logs from ${ipAddress}: ${logUrl}`);
      
      // Test if the URL is accessible
      try {
        axios.get(logUrl,{timeout: 10000}).then(async response => {
          const logContent = response.data;          
          if (!logContent) {
            return;
          }
          const logLines = logContent.split('\n').filter(line => line.trim());         
          if (logLines.length === 0) {
            console.log(`No log lines from ${ipAddress}`);
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
            console.log(`Processing ${newLines.length} new log lines from ${ipAddress}`);
            await this.saveLogEntries(newLines);
            
            // Update last processed timestamp
            if (newLines.length > 0) {
              this.lastProcessedTimestamps[ipAddress] = Math.max(...newLines.map(l => l.timestamp));
            }
          }
        }).catch(error => {
          console.log(error)
        })
        

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
    const convertedStr = timestampStr.replace(/(\d+)\/(\w+)\/(\d+):/, '$1 $2 $3 ');
   
    const date = new Date(convertedStr);
    console.log('Parsed date:', date);
    
    if (isNaN(date.getTime())) {
      console.error('Invalid date parsed:', convertedStr);
      return null;
    }
    
    return Math.floor(date.getTime() / 1000);
  }

  async saveLogEntries(logEntries) {
    if (logEntries.length === 0) return;

    const connection = await connectToDatabase();
    try {
      // Insert log entries
      const logValues = logEntries.map(entry => 
        `('${entry.ip}', FROM_UNIXTIME(${entry.timestamp}), '${entry.domain}', '${entry.requestMethod}', '${entry.requestPath}', ${entry.statusCode}, ${entry.responseTime}, '${entry.userAgent.replace(/'/g, "''")}')`
      ).join(', ');

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

      // Process IPs for blocking
      await this.processIPsForBlocking(logEntries, connection);

      console.log(`Saved ${logEntries.length} log entries`);
    } catch (error) {
      console.error('Error saving log entries:', error);
    } finally {
      await disconnectFromDatabase(connection);
    }
  }

  async processIPsForBlocking(logEntries, connection) {
    try {
      const uniqueIPs = [...new Set(logEntries.map(entry => entry.ip))];
      
      for (const ip of uniqueIPs) {
        // Check if IP is already blocked
        const existingIP = await this.getExistingIP(connection, ip);
        
        if (!existingIP) {
          // Get IP information
          const ipInfo = await this.getIPInfo(ip);
          
          // Insert new IP record
          await this.insertIPRecord(connection, ip, ipInfo);
        } else {
          // Update request count
          await this.updateIPRequestCount(connection, ip);
        }
      }

      // Update statistics
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

  async insertIPRecord(connection, ip, ipInfo) {
    try {
      const query = `
        INSERT INTO blocked_ips (ip, country_code, asn, is_blocked, request_count)
        VALUES (?, ?, ?, ?, 1)
      `;
      await runSqlQuery(connection, query, [ip, ipInfo.countryCode, ipInfo.asn, ipInfo.isBlocked]);
    } catch (error) {
      console.error('Error inserting IP record:', error);
    }
  }

  async updateIPRequestCount(connection, ip) {
    try {
      const query = 'UPDATE blocked_ips SET request_count = request_count + 1, last_seen = CURRENT_TIMESTAMP WHERE ip = ?';
      await runSqlQuery(connection, query, [ip]);
    } catch (error) {
      console.error('Error updating IP request count:', error);
    }
  }

  async updateStatistics(connection) {
    try {
      // Update country statistics
      const countryQuery = `
        INSERT INTO country_stats (country_code, total_blocked_ips)
        SELECT country_code, COUNT(*) as total
        FROM blocked_ips
        WHERE is_blocked = 1
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
        WHERE is_blocked = 1
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
      
      // Remove logs older than 5 minutes
      const fiveMinutesAgo = Math.floor(Date.now() / 1000) - (5 * 60);
      const query = 'DELETE FROM log_entries WHERE timestamp < FROM_UNIXTIME(?)';
      await runSqlQuery(connection, query, [fiveMinutesAgo]);
      
      await disconnectFromDatabase(connection);
      console.log('Cleaned old logs');
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