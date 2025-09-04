const mysql = require("mysql2/promise");
require("dotenv").config();
const { exec } = require("child_process");

exports.connectToDatabase = async () => {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DATABASE_HOST ?? "localhost",
      user: process.env.DATABASE_USER ?? "root",
      password: process.env.DATABASE_PASSWORD ?? "",
      database: process.env.DATABASE_DB ?? "",
      connectTimeout: 30000,
      connectionLimit: 300,
    });
    // console.log("Connected to the database successfully.");
    return connection;
  } catch (error) {
    console.error("Error connecting to the database:", error);
    throw error;
  }
};

exports.disconnectFromDatabase = async (connection) => {
  try {
    await connection.end();
    // console.log("Disconnected from the database successfully.");
  } catch (error) {
    console.error("Error disconnecting from the database:", error);
    // throw error;
  }
};

exports.runSqlQuery = async (connection, query, params = []) => {
  try {
    const [results] = await connection.execute(query, params);
    return results;
  } catch (error) {
    console.error("Error executing SQL query:", error);
    if (JSON.stringify(error).includes("Too many connections")) {
      this.restartMySQLService();
    }
    throw error;
  }
};

exports.restartMySQLService = () => {
  return new Promise((resolve, reject) => {
    exec("sudo service mysql restart", (error, stdout, stderr) => {
      if (error) {
        console.error(`Error restarting MySQL service: ${error}`);
        reject(error);
        return;
      }
      if (stderr) {
        console.error(`MySQL restart stderr: ${stderr}`);
      }
      console.log(`MySQL service restarted successfully: ${stdout}`);
      resolve(stdout);
    });
  });
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

exports.getWhitelist = async () => {
  const connection = await this.connectToDatabase();
  const query = 'SELECT * FROM whitelist';
  const results = await this.runSqlQuery(connection, query);
  await this.disconnectFromDatabase(connection);
  return results;
};