const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const { createTables, addBlockingDaysColumn, updateBlockingDays } = require('./database');
const LogProcessor = require('./logProcessor');
const {fetchBlockData} = require('./fetchAndCacheIP');
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

// Serve static files but protect them
app.use('/public', (req, res, next) => {
  if (req.path === '/login.html') {
    return next();
  }
  requireAuth(req, res, next);
}, express.static(path.join(__dirname, 'public')));

// Initialize log processor
const logProcessor = new LogProcessor();

// Initialize app with migration
async function initializeApp() {
  try {
    await createTables();
    
    // Add blocking_days column if it doesn't exist
    await addBlockingDaysColumn();
    
    console.log('App initialized successfully');
  } catch (error) {
    console.error('Error initializing app:', error);
    process.exit(1);
  }
}

// Authentication routes
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  // Check credentials from environment variables
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

// Protected API Routes
app.get('/api/blocked-ips', async (req, res) => {
  try {
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    const query = `
      SELECT b.ip
      FROM blocked_ips b
      LEFT JOIN whitelist w ON b.ip = w.ip
      WHERE w.ip IS NULL and b.request_count > 3;
    `;
    const results = await runSqlQuery(connection, query);
    await disconnectFromDatabase(connection);
    const ipLongs = results.map(row => ipToLong(row.ip));
    res.json(ipLongs.sort());
  } catch (error) {
    console.error('Error fetching blocked IPs:', error);
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

// Whitelist IP endpoint
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

// Paginated IPs by country
app.get('/api/ips/country/:countryCode', requireAuth, async (req, res) => {
  try {
    const { countryCode } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    
    try {
      // Get total count
      const countQuery = `
        SELECT COUNT(*) as total
        FROM blocked_ips
        WHERE country_code = ?
      `;
      const countResult = await runSqlQuery(connection, countQuery, [countryCode]);
      const total = countResult[0].total;
      const query = `
        SELECT ip, country_code, asn, request_count, is_blocked, blocking_days, last_seen
        FROM blocked_ips
        WHERE country_code = ?
        ORDER BY request_count DESC
        LIMIT ? OFFSET ?
      `;
      
      const results = await runSqlQuery(connection, query, [countryCode, limit, offset]);
      const whitelist = await runSqlQuery(connection, 'SELECT ip FROM whitelist');
      
      // Add whitelist status to results
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

// Paginated IPs by ASN
app.get('/api/ips/asn/:asn', requireAuth, async (req, res) => {
  try {
    const { asn } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    
    try {
      // Get total count
      const countQuery = `
        SELECT COUNT(*) as total
        FROM blocked_ips
        WHERE asn = ?
      `;
      const countResult = await runSqlQuery(connection, countQuery, [asn]);
      const total = countResult[0].total;
      
      // Get paginated results
      const query = `
        SELECT ip, country_code, asn, request_count, is_blocked, blocking_days, last_seen
        FROM blocked_ips
        WHERE asn = ?
        ORDER BY request_count DESC
        LIMIT ? OFFSET ?
      `;
      
      const results = await runSqlQuery(connection, query, [asn, limit, offset]);
      
      // Get whitelist status
      const whitelist = await runSqlQuery(connection, 'SELECT ip FROM whitelist');
      
      // Add whitelist status to results
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

// Search IPs by country with IP string filter
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
        SELECT ip, country_code, asn, request_count, is_blocked, blocking_days, last_seen
        FROM blocked_ips
        WHERE country_code = ? AND ip LIKE ?
        ORDER BY request_count DESC
        LIMIT 100
      `;
      
      const results = await runSqlQuery(connection, query, [countryCode, `%${searchTerm}%`]);
      const whitelist = await runSqlQuery(connection, 'SELECT ip FROM whitelist');
      
      // Add whitelist status to results
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

// Search IPs by ASN with IP string filter
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
        SELECT ip, country_code, asn, request_count, is_blocked, blocking_days, last_seen
        FROM blocked_ips
        WHERE asn = ? AND ip LIKE ?
        ORDER BY request_count DESC
        LIMIT 100
      `;
      
      const results = await runSqlQuery(connection, query, [asn, `%${searchTerm}%`]);
      const whitelist = await runSqlQuery(connection, 'SELECT ip FROM whitelist');
      
      // Add whitelist status to results
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

// Paginated logs by IP
app.get('/api/logs/ip/:ip', async (req, res) => {
  try {
    const { ip } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    
    try {
      // Get total count
      const countQuery = `
        SELECT COUNT(*) as total
        FROM log_entries
        WHERE ip = ?
      `;
      const countResult = await runSqlQuery(connection, countQuery, [ip]);
      const total = countResult[0].total;
      
      // Get paginated results
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

// Check if IP is blocked (no auth required)
app.get('/api/check-ip/:ip', async (req, res) => {
  try {
    const { ip } = req.params;
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    
    const query = `
      SELECT b.ip, b.is_blocked, b.request_count, b.blocking_days, b.last_seen
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
      const countResult = await runSqlQuery(connection, countQuery, [ip, `%${domain}%`]);
      const total = countResult[0].total;
      const query = `
        SELECT ip, timestamp, domain, request_method, request_path, 
               status_code, response_time, user_agent
        FROM log_entries
        WHERE ip = ? AND domain LIKE ?
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `;
      const results = await runSqlQuery(connection, query, [ip, `%${domain}%`, limit, offset]);
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

// Serve login page for unauthenticated users
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

function startCronJobs() {
  // Process category 9 logs every 2 minutes
  cron.schedule('*/10 * * * *', async () => {
    console.log('Running category 9 log processing...');
    try {
      await logProcessor.processCategory9Logs();
    } catch (error) {
      console.error('Error in cron job:', error);
    }
  });

  // Update blocking days daily at 1:00 AM
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

// Start server
app.listen(PORT, async () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  // Initialize database and start cron jobs
  await initializeApp();
  startCronJobs();
});

module.exports = app;