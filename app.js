const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const { createTables } = require('./database');
const LogProcessor = require('./logProcessor');
const {fetchBlockData} = require('./fetchAndCacheIP');
const { ipToLong } = require('./ipLookup');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize log processor
const logProcessor = new LogProcessor();

// Initialize database tables on startup
async function initializeApp() {
  try {
    await createTables();
    await fetchBlockData();
  } catch (error) {
    console.error('Failed to initialize database:', error);
  }
}

// API Routes
app.get('/api/blocked-ips', async (req, res) => {
  try {
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    const query = `
      SELECT ip
      FROM blocked_ips
      WHERE is_blocked = 0
    `;
    const results = await runSqlQuery(connection, query);
    await disconnectFromDatabase(connection);
    const ipLongs = results.map(row => ipToLong(row.ip));
    res.json(ipLongs);
  } catch (error) {
    console.error('Error fetching blocked IPs:', error);
    res.status(500).json({ error: 'Failed to fetch blocked IPs' });
  }
});

app.get('/api/stats/countries', async (req, res) => {
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

app.get('/api/stats/asn', async (req, res) => {
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

// Whitelist IP endpoint
app.post('/api/whitelist', async (req, res) => {
  try {
    const { ip } = req.body;
    if (!ip) {
      return res.status(400).json({ error: 'IP address is required' });
    }

    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    
    try {
      await runSqlQuery(connection, 'DELETE FROM log_entries WHERE ip = ?', [ip]);
      await runSqlQuery(connection, 'DELETE FROM blocked_ips WHERE ip = ?', [ip]);
      
      await runSqlQuery(connection, 'INSERT IGNORE INTO whitelist (ip) VALUES (?)', [ip]);
      const logProcessor = new LogProcessor();
      await logProcessor.updateStatistics(connection);
      await runSqlQuery(connection, 'COMMIT');
      res.json({ message: `IP ${ip} has been whitelisted and removed from database` });
    } catch (error) {
      // Rollback transaction on error
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

// Serve the main page
app.get('/api/ips/country/:countryCode', async (req, res) => {
  try {
    const { countryCode } = req.params;
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    
    const query = `
      SELECT ip, country_code, asn, request_count, is_blocked, last_seen
      FROM blocked_ips
      WHERE country_code = ?
      ORDER BY request_count DESC
    `;
    
    const results = await runSqlQuery(connection, query, [countryCode]);
    await disconnectFromDatabase(connection);
    
    res.json(results);
  } catch (error) {
    console.error('Error fetching IPs by country:', error);
    res.status(500).json({ error: 'Failed to fetch IPs' });
  }
});
app.get('/api/config', (req, res) => {
  res.json({
    startTime: parseInt(process.env.START_TIME) || 2,
    endTime: parseInt(process.env.END_TIME) || 5
  });
});
app.get('/api/ips/asn/:asn', async (req, res) => {
  try {
    const { asn } = req.params;
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    
    const query = `
      SELECT ip, country_code, asn, request_count, is_blocked, last_seen
      FROM blocked_ips
      WHERE asn = ?
      ORDER BY request_count DESC
    `;
    
    const results = await runSqlQuery(connection, query, [asn]);
    await disconnectFromDatabase(connection);
    
    res.json(results);
  } catch (error) {
    console.error('Error fetching IPs by ASN:', error);
    res.status(500).json({ error: 'Failed to fetch IPs' });
  }
});

app.get('/api/logs/ip/:ip', async (req, res) => {
  try {
    const { ip } = req.params;
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    
    const query = `
      SELECT ip, timestamp, domain, request_method, request_path, 
             status_code, response_time, user_agent
      FROM log_entries
      WHERE ip = ?
      ORDER BY timestamp DESC
      LIMIT 100
    `;
    
    const results = await runSqlQuery(connection, query, [ip]);
    await disconnectFromDatabase(connection);
    
    res.json(results);
  } catch (error) {
    console.error('Error fetching logs by IP:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

app.get('/api/total-blocked', async (req, res) => {
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

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

//Start cron jobs
function startCronJobs() {
  // Process category 9 logs every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    console.log('Running category 9 log processing...');
    try {
      await logProcessor.processCategory9Logs();
    } catch (error) {
      console.error('Error in cron job:', error);
    }
  });

  // Clean old logs every 5 minutes
  // cron.schedule('*/5 * * * *', async () => {
  //   console.log('Running log cleanup...');
  //   try {
  //     await logProcessor.cleanOldLogs();
  //   } catch (error) {
  //     console.error('Error in cleanup cron job:', error);
  //   }
  // });
setTimeout(() => {
  logProcessor.processCategory9Logs()
}, 4000);
  console.log('Cron jobs started');
}

// Start server
app.listen(PORT, async () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  // Initialize database and start cron jobs
  await initializeApp();
  startCronJobs();
});

module.exports = app;