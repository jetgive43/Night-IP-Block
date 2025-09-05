const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const { createTables } = require('./database');
const LogProcessor = require('./logProcessor');
const {fetchBlockData} = require('./fetchAndCacheIP');
const { ipToLong } = require('./ipLookup');

const app = express();
const PORT = process.env.PORT || 3000;

// Load environment variables
require('dotenv').config();

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Set to true if using HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Authentication middleware
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

// Initialize database tables on startup
async function initializeApp() {
  try {
    await createTables();
    await fetchBlockData();
  } catch (error) {
    console.error('Failed to initialize database:', error);
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
      WHERE w.ip IS NULL;
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

app.get('/api/ips/country/:countryCode', requireAuth, async (req, res) => {
  try {
    const { countryCode } = req.params;
    const { runSqlQuery, connectToDatabase, disconnectFromDatabase } = require('./database');
    const connection = await connectToDatabase();
    
    const query = `
      SELECT ip, country_code, asn, request_count, is_blocked, last_seen, created_at
      FROM blocked_ips
      WHERE country_code = ?
      ORDER BY request_count DESC
    `;
    const whitelist = await runSqlQuery(connection, 'SELECT ip FROM whitelist');
    const results = await runSqlQuery(connection, query, [countryCode]);
    await disconnectFromDatabase(connection);
    
    results.forEach(result => {
      result.is_whitelisted = whitelist.some(whitelistedIp => whitelistedIp.ip === result.ip);
    });
    res.json(results);
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

app.get('/api/logs/ip/:ip', requireAuth, async (req, res) => {
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

// Serve login page for unauthenticated users
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Serve the main page (protected)
app.get('/', (req, res) => {
  if (req.session && req.session.authenticated) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.redirect('/login');
  }
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