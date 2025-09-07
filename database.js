const mysql = require("mysql2/promise");
require("dotenv").config();
const { exec } = require("child_process");

const dbConfig = {
  host: process.env.DATABASE_HOST || 'localhost',
  user: process.env.DATABASE_USER || 'root',
  password: process.env.DATABASE_PASSWORD || '',
  database: process.env.DATABASE_DB || 'night_ip_block',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

exports.connectToDatabase = async () => {
  return await pool.getConnection();
};

exports.runSqlQuery = async (connection, query, params = []) => {
  try {
    const [rows] = await connection.execute(query, params);
    return rows;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

exports.disconnectFromDatabase = async (connection) => {
  if (connection) {
    connection.release();
  }
};

exports.createTables = async () => {
  const connection = await this.connectToDatabase();
  try {
    // Create blocked_ips table
    const createBlockedIpsTable = `
      CREATE TABLE IF NOT EXISTS blocked_ips (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ip VARCHAR(45) NOT NULL,
        country_code VARCHAR(10),
        asn VARCHAR(50),
        request_count INT DEFAULT 0,
        is_blocked TINYINT DEFAULT 0,
        blocking_days INT DEFAULT 0,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_ip (ip)
      )
    `;
    await this.runSqlQuery(connection, createBlockedIpsTable);

    // Create log_entries table
    const createLogEntriesTable = `
      CREATE TABLE IF NOT EXISTS log_entries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ip VARCHAR(45) NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        domain VARCHAR(255),
        request_method VARCHAR(10),
        request_path TEXT,
        status_code INT,
        response_time DECIMAL(10,3),
        user_agent TEXT,
        is_processed TINYINT DEFAULT 0,
        processed_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ip (ip),
        INDEX idx_timestamp (timestamp),
        INDEX idx_is_processed (is_processed)
      )
    `;
    await this.runSqlQuery(connection, createLogEntriesTable);

    // Create country_stats table
    const createCountryStatsTable = `
      CREATE TABLE IF NOT EXISTS country_stats (
        id INT AUTO_INCREMENT PRIMARY KEY,
        country_code VARCHAR(10) NOT NULL,
        total_blocked_ips INT DEFAULT 0,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_country (country_code)
      )
    `;
    await this.runSqlQuery(connection, createCountryStatsTable);

    // Create whitelist table
    const createWhitelistTable = `
      CREATE TABLE IF NOT EXISTS whitelist (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ip VARCHAR(45) NOT NULL,
        created_by VARCHAR(100) DEFAULT 'system',
        UNIQUE KEY unique_ip (ip)
      )
    `;
    await this.runSqlQuery(connection, createWhitelistTable);

    // Create asn_stats table
    const createAsnStatsTable = `
      CREATE TABLE IF NOT EXISTS asn_stats (
        id INT AUTO_INCREMENT PRIMARY KEY,
        asn VARCHAR(50) NOT NULL,
        country_code VARCHAR(10),
        total_blocked_ips INT DEFAULT 0,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_asn (asn)
      )
    `;
    await this.runSqlQuery(connection, createAsnStatsTable);

    console.log("Database tables created successfully");
  } catch (error) {
    console.error("Error creating tables:", error);
    throw error;
  } finally {
    await this.disconnectFromDatabase(connection);
  }
};

// Add blocking_days column to existing blocked_ips table
exports.addBlockingDaysColumn = async () => {
  const connection = await this.connectToDatabase();
  try {
    // Check if blocking_days column exists
    const checkColumnQuery = `
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'blocked_ips' 
      AND COLUMN_NAME = 'blocking_days'
    `;
    
    const columnExists = await this.runSqlQuery(connection, checkColumnQuery);
    
    if (columnExists.length === 0) {
      // Add the blocking_days column
      const addColumnQuery = `
        ALTER TABLE blocked_ips 
        ADD COLUMN blocking_days INT DEFAULT 0 AFTER is_blocked
      `;
      await this.runSqlQuery(connection, addColumnQuery);
      console.log("Added blocking_days column to blocked_ips table");
    } else {
      console.log("blocking_days column already exists");
    }
  } catch (error) {
    console.error("Error adding blocking_days column:", error);
    throw error;
  } finally {
    await this.disconnectFromDatabase(connection);
  }
};

// Calculate and update blocking days for all IPs
exports.updateBlockingDays = async () => {
  const connection = await this.connectToDatabase();
  try {
    console.log("Starting blocking days update...");
    const getIPsQuery = `
      SELECT ip FROM blocked_ips
    `;
    const ips = await this.runSqlQuery(connection, getIPsQuery);
    
    console.log(`Found ${ips.length} IPs to update blocking days for`);
    
    for (const ipRecord of ips) {
      const ip = ipRecord.ip;
      
      const countDaysQuery = `
        SELECT COUNT(DISTINCT DATE(timestamp)) as days_count
        FROM log_entries 
        WHERE ip = ?
      `;
      
      const result = await this.runSqlQuery(connection, countDaysQuery, [ip]);
      const blockingDays = result[0].days_count || 0;
      
      // Update the blocking_days field
      const updateQuery = `
        UPDATE blocked_ips 
        SET blocking_days = ? 
        WHERE ip = ?
      `;
      
      await this.runSqlQuery(connection, updateQuery, [blockingDays, ip]);
    }
    
    console.log("Blocking days update completed successfully");
  } catch (error) {
    console.error("Error updating blocking days:", error);
    throw error;
  } finally {
    await this.disconnectFromDatabase(connection);
  }
};

exports.getWhitelist = async () => {
  const connection = await this.connectToDatabase();
  const query = 'SELECT * FROM whitelist';
  const results = await this.runSqlQuery(connection, query);
  await this.disconnectFromDatabase(connection);
  return results;
};