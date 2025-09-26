const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const { createTables, addBlockingDaysColumn, addUsernameColumn, updateBlockingDays, addUserTypeColumn } = require('./database');
const LogProcessor = require('./logProcessor');
const {fetchBlockData, initializeUserDomainList} = require('./fetchAndCacheIP');
const { getUserNameFromDomain } = require('./fetchAndCacheIP');
const { ipToLong } = require('./ipLookup');

const app = express();
const PORT = process.env.PORT || 3000;
require('dotenv').config();
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    maxAge: 24 * 60 * 60 * 1000
  }
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  } else {
    return res.status(401).json({ error: 'Authentication required' });
  }
}

app.use('/public', (req, res, next) => {
  if (req.path === '/login.html') {
    return next();
  }
  requireAuth(req, res, next);
}, express.static(path.join(__dirname, 'public')));

const logProcessor = new LogProcessor();

async function initializeApp() {
  try {
    await createTables();
    
    await addBlockingDaysColumn();
    
    await addUsernameColumn();
    
    await addUserTypeColumn();
    
    await initializeUserDomainList();
    
    console.log('App initialized successfully');
  } catch (error) {
    console.error('Error initializing app:', error);
    process.exit(1);
  }
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const validUsername = process.env.ADMIN_USERNAME || 'admin';
  const validPassword = process.env.ADMIN_PASSWORD || 'admin';
  console.log(validUsername, validPassword);
  
  if (username === validUsername && password === validPassword) {
    req.session.authenticated = true;
    req.session.username = username;
    res.json({ success: true, message: 'Login successful' });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Could not log out' });
    }
    res.json({ success: true, message: 'Logout successful' });
  });
});

app.get('/api/auth/status', (req, res) => {
  res.json({ 
    authenticated: !!(req.session && req.session.authenticated),
    username: req.session?.username || null
  });
});

app.get('/api/blocked-ips', async (req, res) => {
  try {
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    const limistblockingdays = parseInt(process.env.LIMIT_BLOCKING_DAYS) || 5;
    const username = req.query.username;
    if(!username) {
      const query = `
        SELECT b.ip
        FROM blocked_ips b
        LEFT JOIN whitelist w ON b.ip = w.ip
        WHERE w.ip IS NULL and b.blocking_days > ${limistblockingdays} and b.user_type = 1;
      `;
      const results = await runSqlQuery(connection, query);
      await disconnectFromDatabase(connection);
      const ipLongs = results.map(row => ipToLong(row.ip));
      res.json(ipLongs.sort());
    }else {
      const query = `
        SELECT b.ip
        FROM blocked_ips b
        LEFT JOIN whitelist w ON b.ip = w.ip
        WHERE w.ip IS NULL and b.blocking_days >= ${limistblockingdays} and FIND_IN_SET(?, b.username) > 0 and b.user_type = 1;
      `;
      const results = await runSqlQuery(connection, query, [username]);
      let ips = [];
      results
      .forEach(row => {
        ips.push(row.ip);
      });
      await disconnectFromDatabase(connection);
      res.json(ips);
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch blocked IPs' });
  }
});
app.get('/api/stats/countries', requireAuth, async (req, res) => {
  try {
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    
    const query = `
      SELECT cs.country_code, cs.total_blocked_ips, 
             COUNT(bi.ip) as total_ips
      FROM country_stats cs
      LEFT JOIN blocked_ips bi ON cs.country_code = bi.country_code
      GROUP BY cs.country_code, cs.total_blocked_ips
      ORDER BY cs.total_blocked_ips DESC
    `;
    
    const results = await runSqlQuery(connection, query);
    await disconnectFromDatabase(connection);
    
    res.json(results);
  } catch (error) {
    console.error('Error fetching country stats:', error);
    res.status(500).json({ error: 'Failed to fetch country statistics' });
  }
});

app.get('/api/stats/asn', requireAuth, async (req, res) => {
  try {
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    
    const query = `
      SELECT asn, country_code, total_blocked_ips
      FROM asn_stats
      ORDER BY total_blocked_ips DESC
    `;
    
    const results = await runSqlQuery(connection, query);
    await disconnectFromDatabase(connection);
    
    res.json(results);
  } catch (error) {
    console.error('Error fetching ASN stats:', error);
    res.status(500).json({ error: 'Failed to fetch ASN statistics' });
  }
});

app.post('/api/whitelist', requireAuth, async (req, res) => {
  try {
    const { ip } = req.body;
    if (!ip) {
      return res.status(400).json({ error: 'IP address is required' });
    }

    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    
    try {      
      const res_ip = await runSqlQuery(connection, 'SELECT ip FROM whitelist WHERE ip = ?', [ip]);
      if(res_ip.length > 0) {
        await runSqlQuery(connection, 'DELETE FROM whitelist WHERE ip = ?', [ip]);
        res.json({ message: `IP ${ip} has been removed from whitelist` });
      } else {
        await runSqlQuery(connection, 'INSERT IGNORE INTO whitelist (ip) VALUES (?)', [ip]);
        res.json({ message: `IP ${ip} has been whitelisted` });
      }
    } catch (error) {
      await runSqlQuery(connection, 'ROLLBACK');
      throw error;
    } finally {
      await disconnectFromDatabase(connection);
    }
  } catch (error) {
    console.error('Error whitelisting IP:', error);
    res.status(500).json({ error: 'Failed to whitelist IP' });
  }
});

app.get('/api/ips/country/:countryCode', requireAuth, async (req, res) => {
  try {
    const { countryCode } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    
    try {
      const countQuery = `
        SELECT COUNT(*) as total
        FROM blocked_ips
        WHERE country_code = ?
      `;
      const countResult = await runSqlQuery(connection, countQuery, [countryCode]);
      const total = countResult[0].total;
      const query = `
        SELECT ip, country_code, asn, request_count, is_blocked, blocking_days, last_seen, username
        FROM blocked_ips
        WHERE country_code = ?
        ORDER BY request_count DESC
        LIMIT ? OFFSET ?
      `;
      
      const results = await runSqlQuery(connection, query, [countryCode, limit, offset]);
      const whitelist = await runSqlQuery(connection, 'SELECT ip FROM whitelist');
      
      results.forEach(result => {
        result.is_whitelisted = whitelist.some(whitelistedIp => whitelistedIp.ip === result.ip);
      });
      
      res.json({
        data: results,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      });
    } finally {
      await disconnectFromDatabase(connection);
    }
  } catch (error) {
    console.error('Error fetching IPs by country:', error);
    res.status(500).json({ error: 'Failed to fetch IPs' });
  }
});

app.get('/api/config', requireAuth, (req, res) => {
  res.json({
    startTime: parseInt(process.env.START_TIME) || 2,
    endTime: parseInt(process.env.END_TIME) || 5
  });
});

app.get('/api/ips/asn/:asn', requireAuth, async (req, res) => {
  try {
    const { asn } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    
    try {
      const countQuery = `
        SELECT COUNT(*) as total
        FROM blocked_ips
        WHERE asn = ?
      `;
      const countResult = await runSqlQuery(connection, countQuery, [asn]);
      const total = countResult[0].total;
      
      const query = `
        SELECT ip, country_code, asn, request_count, is_blocked, blocking_days, last_seen, username
        FROM blocked_ips
        WHERE asn = ?
        ORDER BY request_count DESC
        LIMIT ? OFFSET ?
      `;
      
      const results = await runSqlQuery(connection, query, [asn, limit, offset]);
      
      const whitelist = await runSqlQuery(connection, 'SELECT ip FROM whitelist');
      
      results.forEach(result => {
        result.is_whitelisted = whitelist.some(whitelistedIp => whitelistedIp.ip === result.ip);
      });
      
      res.json({
        data: results,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      });
    } finally {
      await disconnectFromDatabase(connection);
    }
  } catch (error) {
    console.error('Error fetching IPs by ASN:', error);
    res.status(500).json({ error: 'Failed to fetch IPs' });
  }
});

app.get('/api/ips/country/:countryCode/search', requireAuth, async (req, res) => {
  try {
    const { countryCode } = req.params;
    const searchTerm = req.query.q;
    
    if (!searchTerm) {
      return res.status(400).json({ error: 'Search term is required' });
    }
    
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    
    try {
      const query = `
        SELECT ip, country_code, asn, request_count, is_blocked, blocking_days, last_seen, username
        FROM blocked_ips
        WHERE country_code = ? AND ip LIKE ?
        ORDER BY request_count DESC
        LIMIT 100
      `;
      
      const results = await runSqlQuery(connection, query, [countryCode, `%${searchTerm}%`]);
      const whitelist = await runSqlQuery(connection, 'SELECT ip FROM whitelist');
      results.forEach(result => {
        result.is_whitelisted = whitelist.some(whitelistedIp => whitelistedIp.ip === result.ip);
      });
      
      res.json({
        data: results,
        pagination: {
          page: 1,
          limit: 100,
          total: results.length,
          totalPages: 1,
          hasNext: false,
          hasPrev: false
        }
      });
    } finally {
      await disconnectFromDatabase(connection);
    }
  } catch (error) {
    console.error('Error searching IPs by country:', error);
    res.status(500).json({ error: 'Failed to search IPs' });
  }
});

app.get('/api/ips/search', async (req, res) => {
  try {
  const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
  const connection = await connectToDatabase();
  const searchTerm = req.query.q;
  const query = `
    SELECT ip, country_code, asn, request_count, is_blocked, blocking_days, last_seen, username
    FROM blocked_ips
    WHERE ip LIKE ?
    ORDER BY request_count DESC
    LIMIT 100
  `;
  const whitelist = await runSqlQuery(connection, 'SELECT ip FROM whitelist');
  const results = await runSqlQuery(connection, query, [`%${searchTerm}%`]);
  results.forEach(result => {
    result.is_whitelisted = whitelist.some(whitelistedIp => whitelistedIp.ip === result.ip);
  });
  await disconnectFromDatabase(connection);
  res.json({
    data: results,
    pagination: {
      page: 1,
      limit: 100,
      total: results.length,
      totalPages: 1,
      hasNext: false,
      hasPrev: false
    }
    });
  } catch (error) {
    console.error('Error searching IPs:', error);
    res.status(500).json({ error: 'Failed to search IPs' });
  }
});

app.get('/api/ips/asn/:asn/search', requireAuth, async (req, res) => {
  try {
    const { asn } = req.params;
    const searchTerm = req.query.q;
    
    if (!searchTerm) {
      return res.status(400).json({ error: 'Search term is required' });
    }
    
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    
    try {
      const query = `
        SELECT ip, country_code, asn, request_count, is_blocked, blocking_days, last_seen, username
        FROM blocked_ips
        WHERE asn = ? AND ip LIKE ?
        ORDER BY request_count DESC
        LIMIT 100
      `;
      
      const results = await runSqlQuery(connection, query, [asn, `%${searchTerm}%`]);
      const whitelist = await runSqlQuery(connection, 'SELECT ip FROM whitelist');
      
      results.forEach(result => {
        result.is_whitelisted = whitelist.some(whitelistedIp => whitelistedIp.ip === result.ip);
      });
      
      res.json({
        data: results,
        pagination: {
          page: 1,
          limit: 100,
          total: results.length,
          totalPages: 1,
          hasNext: false,
          hasPrev: false
        }
      });
    } finally {
      await disconnectFromDatabase(connection);
    }
  } catch (error) {
    console.error('Error searching IPs by ASN:', error);
    res.status(500).json({ error: 'Failed to search IPs' });
  }
});

app.get('/api/logs/ip/:ip', async (req, res) => {
  try {
    const { ip } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    
    try {
      const countQuery = `
        SELECT COUNT(*) as total
        FROM log_entries
        WHERE ip = ?
      `;
      const countResult = await runSqlQuery(connection, countQuery, [ip]);
      const total = countResult[0].total;
      
      const query = `
        SELECT ip, timestamp, domain, request_method, request_path, 
               status_code, response_time, user_agent
        FROM log_entries
        WHERE ip = ?
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `;
      
      const results = await runSqlQuery(connection, query, [ip, limit, offset]);
      await disconnectFromDatabase(connection);
      
      res.json({
        data: results,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      });
    } finally {
      await disconnectFromDatabase(connection);
    }
  } catch (error) {
    console.error('Error fetching logs by IP:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

app.get('/api/total-blocked', requireAuth, async (req, res) => {
  try {
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    
    const query = 'SELECT COUNT(*) as total FROM blocked_ips WHERE is_blocked = 0';
    const results = await runSqlQuery(connection, query);
    await disconnectFromDatabase(connection);
    
    res.json({ total: results[0].total });
  } catch (error) {
    console.error('Error fetching total blocked IPs:', error);
    res.status(500).json({ error: 'Failed to fetch total' });
  }
});

app.get('/api/check-ip/:ip', async (req, res) => {
  try {
    const { ip } = req.params;
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    
    const query = `
      SELECT b.ip, b.is_blocked, b.request_count, b.blocking_days, b.last_seen, b.username
      FROM blocked_ips b
      LEFT JOIN whitelist w ON b.ip = w.ip
      WHERE b.ip = ? AND w.ip IS NULL
    `;
    const results = await runSqlQuery(connection, query, [ip]);
    await disconnectFromDatabase(connection);
    
    const isBlocked = results.length > 0 && results[0].is_blocked === 0;
    res.json({ 
      ip: ip,
      isBlocked: isBlocked,
      details: results.length > 0 ? results[0] : null
    });
  } catch (error) {
    console.error('Error checking IP:', error);
    res.status(500).json({ error: 'Failed to check IP' });
  }
});

app.get('/api/logs/ip-domain/:ip/:domain', async (req, res) => {
  try {
    const { ip, domain } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    
    try {
      const countQuery = `
        SELECT COUNT(*) as total
        FROM log_entries
        WHERE ip = ? AND domain LIKE ?
      `;
      const countResult = await runSqlQuery(connection, countQuery, [ip, `%${domain}`]);
      const total = countResult[0].total;
      const query = `
        SELECT ip, timestamp, domain, request_method, request_path, 
               status_code, response_time, user_agent
        FROM log_entries
        WHERE ip = ? AND domain LIKE ?
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `;
      const results = await runSqlQuery(connection, query, [ip, `%${'.'+domain}`, limit, offset]);
      await disconnectFromDatabase(connection);
      res.json({
        data: results,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      });
    } finally {
      await disconnectFromDatabase(connection);
    }
  } catch (error) {
    console.error('Error fetching logs for IP and domain:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

app.get('/api/mysql/resources', requireAuth, async (req, res) => {
  try {
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    const connection = await connectToDatabase();
    
    try {
      const dbName = process.env.DATABASE_DB || 'night_ip_block';
      
      let statusResults = [];
      let variableResults = [];
      let sizeResults = [];
      let countResults = [];
      
      try {
        const mysqlQueries = [
          `SELECT 
            VARIABLE_NAME, VARIABLE_VALUE 
           FROM performance_schema.global_status 
           WHERE VARIABLE_NAME IN ('Threads_running', 'Threads_connected', 'Uptime')`,
          
          `SELECT 
            VARIABLE_NAME, VARIABLE_VALUE 
           FROM performance_schema.global_variables 
           WHERE VARIABLE_NAME IN ('innodb_buffer_pool_size', 'key_buffer_size', 'max_connections')`
        ];
        
        [statusResults, variableResults] = await Promise.all([
          runSqlQuery(connection, mysqlQueries[0]),
          runSqlQuery(connection, mysqlQueries[1])
        ]);
      } catch (perfError) {
        console.log('Performance schema not available, using SHOW commands');
        try {
          const [statusRows, variableRows] = await Promise.all([
            runSqlQuery(connection, `SHOW STATUS WHERE Variable_name IN ('Threads_running', 'Threads_connected', 'Uptime')`),
            runSqlQuery(connection, `SHOW VARIABLES WHERE Variable_name IN ('innodb_buffer_pool_size', 'key_buffer_size', 'max_connections')`)
          ]);
          
          statusResults = statusRows.map(row => ({
            VARIABLE_NAME: row.Variable_name,
            VARIABLE_VALUE: row.Value
          }));
          
          variableResults = variableRows.map(row => ({
            VARIABLE_NAME: row.Variable_name,
            VARIABLE_VALUE: row.Value
          }));
        } catch (showError) {
          console.log('SHOW commands failed, using minimal data');
          statusResults = [
            { VARIABLE_NAME: 'Threads_running', VARIABLE_VALUE: '0' },
            { VARIABLE_NAME: 'Threads_connected', VARIABLE_VALUE: '1' },
            { VARIABLE_NAME: 'Uptime', VARIABLE_VALUE: '0' }
          ];
          variableResults = [
            { VARIABLE_NAME: 'innodb_buffer_pool_size', VARIABLE_VALUE: '134217728' },
            { VARIABLE_NAME: 'key_buffer_size', VARIABLE_VALUE: '8388608' },
            { VARIABLE_NAME: 'max_connections', VARIABLE_VALUE: '151' }
          ];
        }
      }
      
      try {
        const [sizeRows, countRows] = await Promise.all([
          runSqlQuery(connection, `
            SELECT 
              table_schema AS 'database_name',
              ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS 'size_mb'
            FROM information_schema.tables 
            WHERE table_schema = ?
            GROUP BY table_schema`, [dbName]),
          
          runSqlQuery(connection, `
            SELECT 
              COUNT(*) as table_count,
              SUM(table_rows) as total_rows
            FROM information_schema.tables 
            WHERE table_schema = ?`, [dbName])
        ]);
        
        sizeResults = sizeRows;
        countResults = countRows;
      } catch (infoError) {
        console.log('Information schema queries failed, using defaults');
        sizeResults = [{ database_name: dbName, size_mb: 0 }];
        countResults = [{ table_count: 0, total_rows: 0 }];
      }

      let systemStats = {
        cpu_percent: 0,
        memory_mb: 0,
        memory_percent: 0
      };

      try {
        let command;
        if (process.platform === 'win32') {
          command = `powershell "Get-Process mysql* | Select-Object CPU,WorkingSet | ConvertTo-Json"`;
        } else {
          command = `ps aux | grep [m]ysql | awk '{cpu+=$3; mem+=$4; rss+=$6} END {print cpu","mem","rss}'`;
        }

        const { stdout } = await execAsync(command);
        
        if (process.platform === 'win32' && stdout.trim()) {
          try {
            const processData = JSON.parse(stdout);
            const processes = Array.isArray(processData) ? processData : [processData];
            systemStats.memory_mb = processes.reduce((sum, proc) => sum + (proc.WorkingSet || 0), 0) / 1024 / 1024;
          } catch (e) {
            console.log('Could not parse Windows MySQL process data');
          }
        } else if (stdout.trim()) {
          const [cpu, memPercent, rss] = stdout.trim().split(',').map(parseFloat);
          systemStats.cpu_percent = cpu || 0;
          systemStats.memory_percent = memPercent || 0;
          systemStats.memory_mb = (rss || 0) / 1024;
        }
      } catch (error) {
        console.log('Could not get system MySQL process stats:', error.message);
      }

      const formatResults = (results) => {
        const formatted = {};
        results.forEach(row => {
          formatted[row.VARIABLE_NAME] = row.VARIABLE_VALUE;
        });
        return formatted;
      };

      const status = formatResults(statusResults);
      const variables = formatResults(variableResults);
      const dbSize = sizeResults[0] || { size_mb: 0 };
      const dbCounts = countResults[0] || { table_count: 0, total_rows: 0 };

      let bufferPoolUsage = 0;
      try {
        let bufferPoolQuery = `SELECT 
          VARIABLE_VALUE as pool_size
        FROM performance_schema.global_status 
        WHERE VARIABLE_NAME = 'Innodb_buffer_pool_bytes_data'`;
        
        try {
          const poolResults = await runSqlQuery(connection, bufferPoolQuery);
          if (poolResults.length > 0) {
            const poolSizeBytes = parseInt(variables.innodb_buffer_pool_size || 0);
            const usedBytes = parseInt(poolResults[0].pool_size || 0);
            bufferPoolUsage = poolSizeBytes > 0 ? (usedBytes / poolSizeBytes * 100) : 0;
          }
        } catch (perfError) {
          try {
            const showResults = await runSqlQuery(connection, `SHOW STATUS WHERE Variable_name = 'Innodb_buffer_pool_bytes_data'`);
            if (showResults.length > 0) {
              const poolSizeBytes = parseInt(variables.innodb_buffer_pool_size || 0);
              const usedBytes = parseInt(showResults[0].Value || 0);
              bufferPoolUsage = poolSizeBytes > 0 ? (usedBytes / poolSizeBytes * 100) : 0;
            }
          } catch (showError) {
            console.log('Could not get buffer pool usage');
          }
        }
      } catch (e) {
        console.log('Could not get buffer pool usage');
      }

      const resourceData = {
        mysql_status: {
          uptime_seconds: parseInt(status.Uptime || 0),
          threads_running: parseInt(status.Threads_running || 0),
          threads_connected: parseInt(status.Threads_connected || 0),
          max_connections: parseInt(variables.max_connections || 0)
        },
        memory: {
          innodb_buffer_pool_size_mb: Math.round(parseInt(variables.innodb_buffer_pool_size || 0) / 1024 / 1024),
          key_buffer_size_mb: Math.round(parseInt(variables.key_buffer_size || 0) / 1024 / 1024),
          buffer_pool_usage_percent: Math.round(bufferPoolUsage * 100) / 100,
          system_memory_mb: Math.round(systemStats.memory_mb * 100) / 100,
          system_memory_percent: Math.round(systemStats.memory_percent * 100) / 100
        },
        cpu: {
          system_cpu_percent: Math.round(systemStats.cpu_percent * 100) / 100
        },
        database: {
          name: dbName,
          size_mb: parseFloat(dbSize.size_mb || 0),
          table_count: parseInt(dbCounts.table_count || 0),
          total_rows: parseInt(dbCounts.total_rows || 0)
        },
        connections: {
          current: parseInt(status.Threads_connected || 0),
          max: parseInt(variables.max_connections || 0),
          usage_percent: Math.round((parseInt(status.Threads_connected || 0) / parseInt(variables.max_connections || 1)) * 10000) / 100
        }
      };

      res.json(resourceData);
    } finally {
      await disconnectFromDatabase(connection);
    }
  } catch (error) {
    console.error('Error fetching MySQL resources:', error);
    res.status(500).json({ error: 'Failed to fetch MySQL resources' });
  }
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/', (req, res) => {
  if (req.session && req.session.authenticated) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.redirect('/login');
  }
});

app.get('/ipcheck', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ipcheck.html'));
});
async function updateUserType() {
  const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
  const connection = await connectToDatabase();
  try {
    const query = `
      SELECT id, ip, username
      FROM blocked_ips
      where username is not null;
    `;
    const results = await runSqlQuery(connection, query);
    const ipList = results.map(row => ({
      id: row.id,
      ip: row.ip,
      username: row.username
    }));

    for (const item of ipList) {
      const username = item.username;
      const userNameList = username.split(',');
      console.log(userNameList);
      if (userNameList.length >= 5) {
        const updateQuery = `
          UPDATE blocked_ips
          SET user_type = 2
          WHERE id = ?
        `;
        await runSqlQuery(connection, updateQuery, [item.id]);     }
      else {
        const updateQuery = `
          UPDATE blocked_ips
          SET user_type = 1
          WHERE id = ?
        `;
        await runSqlQuery(connection, updateQuery, [item.id]);
      }
    }
  } finally {
    await disconnectFromDatabase(connection);
  }
}

async function updateUserDomainData() {
  const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
  const connection = await connectToDatabase();
  try {
    const query = `
      SELECT ip, username
      FROM blocked_ips
      WHERE username IS NULL
    `;
    const results = await runSqlQuery(connection, query);
    const userDomainList = results.map(row => ({
      ip: row.ip,
      username: row.username
    }));
    console.log(userDomainList);
    await initializeUserDomainList(userDomainList);
    
    for (const item of userDomainList) {
      const domain = item.username;
      const ip = item.ip;
      
      const domainQuery = `
        SELECT domain
        FROM log_entries
        WHERE ip = ?
      `;
      const domainData = await runSqlQuery(connection, domainQuery, [ip]);
      const domainList = domainData.map(row => row.domain);
      
      let usernameList = [];
      for (const domain of domainList) {
        const username = getUserNameFromDomain(domain);
        if (username && !usernameList.includes(username)) {
          usernameList.push(username);
        }
      }
      if (usernameList.length > 0) {
        const updateQuery = `
          UPDATE blocked_ips
          SET username = ?
          WHERE ip = ?
        `;
        try {
          await runSqlQuery(connection, updateQuery, [usernameList.join(','), ip]);
        } catch (error) {
          console.error('Error in updateUserDomainData cron job:', error);
        }
      }
    }
  } finally {
    await disconnectFromDatabase(connection);
  }
}
function startCronJobs() {
  cron.schedule('*/10 * * * *', async () => {
    console.log('Running category 9 log processing...');
    try {
      await logProcessor.processCategory9Logs();
    } catch (error) {
      console.error('Error in cron job:', error);
    }
  });
  cron.schedule('*/2 * * * *', async () => {
    try {
      await updateUserDomainData();
    } catch (error) {
      console.error('Error in updateUserDomainData cron job:', error);
    }
  })
  cron.schedule('*/20 * * * *', async () => {
    try {
      await updateUserType();
    } catch (error) {
      console.error('Error in updateUserType cron job:', error);
    }
  })
  cron.schedule('0 1 * * *', async () => {
    console.log('Running daily blocking days update...');
    try {
      await updateBlockingDays();
    } catch (error) {
      console.error('Error in blocking days update cron job:', error);
    }
  });

  setTimeout(() => {
    logProcessor.processCategory9Logs()
  }, 4000);
  console.log('Cron jobs started');
}

app.listen(PORT, async () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  await initializeApp();
  startCronJobs();
});

module.exports = app;