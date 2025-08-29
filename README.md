# 🌙 Night IP Block

A real-time IP blocking and monitoring dashboard that fetches logs from CDN nodes and provides comprehensive analytics for blocked IP addresses.

## Features

- **Real-time Log Processing**: Fetches logs from category 9 nodes every 2 minutes
- **IP Blocking System**: Integrates with existing IP blocking cache to determine block status
- **Country & ASN Analytics**: Tracks blocked IPs by country and Autonomous System Number
- **Log Storage**: Stores parsed log entries with timestamp tracking to avoid duplicates
- **Auto-cleanup**: Removes logs older than 5 minutes automatically
- **Modern Web Interface**: Beautiful, responsive dashboard for monitoring and analysis

## Prerequisites

- Node.js (v14 or higher)
- MySQL/MariaDB database
- Access to CDN node logs (port 29876)

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd Night-IP-Block
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   Create a `.env` file in the root directory:
   ```env
   DATABASE_HOST=localhost
   DATABASE_USER=root
   DATABASE_PASSWORD=your_password_here
   DATABASE_DB=night_ip_block
   PORT=3000
   NODE_ENV=development
   ```

4. **Create database**
   ```sql
   CREATE DATABASE night_ip_block;
   ```

5. **Start the application**
   ```bash
   npm start
   ```

## Project Structure

```
Night-IP-Block/
├── app.js                 # Main Express server with API endpoints
├── database.js            # Database connection and table creation
├── fetchAndCacheIP.js     # IP blocking cache system
├── ipLookup.js           # ASN and country lookup utilities
├── logProcessor.js       # Category 9 log processing engine
├── script.js             # Original log processing script
├── utils.js              # Utility functions
├── public/               # Frontend assets
│   └── index.html        # Dashboard interface
├── package.json          # Dependencies and scripts
└── README.md            # This file
```

## Database Schema

### blocked_ips
- `id`: Primary key
- `ip`: IP address
- `country_code`: Country code (e.g., US, ES, PT)
- `asn`: Autonomous System Number
- `request_count`: Number of requests from this IP
- `is_blocked`: Block status (0 = not blocked, 1 = blocked)
- `last_seen`: Last activity timestamp
- `created_at`: Record creation timestamp

### log_entries
- `id`: Primary key
- `ip`: Source IP address
- `timestamp`: Log entry timestamp
- `domain`: Requested domain
- `request_method`: HTTP method (GET, POST, etc.)
- `request_path`: Request path
- `status_code`: HTTP response status
- `response_time`: Response time in seconds
- `user_agent`: User agent string
- `is_processed`: Processing status flag
- `processed_at`: Processing timestamp

### country_stats
- `id`: Primary key
- `country_code`: Country code
- `total_blocked_ips`: Total blocked IPs for this country
- `last_updated`: Last statistics update

### asn_stats
- `id`: Primary key
- `asn`: Autonomous System Number
- `country_code`: Associated country code
- `total_blocked_ips`: Total blocked IPs for this ASN
- `last_updated`: Last statistics update

## API Endpoints

### Statistics
- `GET /api/stats/countries` - Get blocked IP statistics by country
- `GET /api/stats/asn` - Get blocked IP statistics by ASN
- `GET /api/total-blocked` - Get total count of blocked IPs

### IP Management
- `GET /api/ips/country/:countryCode` - Get IPs blocked in a specific country
- `GET /api/ips/asn/:asn` - Get IPs blocked in a specific ASN

### Logs
- `GET /api/logs/ip/:ip` - Get log entries for a specific IP address

## Log Processing

The system processes logs from category 9 nodes with the following workflow:

1. **Fetch Nodes**: Retrieves node list from `https://slave.host-palace.net/portugal_cdn/get_node_list`
2. **Filter Category 9**: Only processes nodes with category = 9
3. **Fetch Logs**: Retrieves logs from `http://{ip}:29876/redirect{ip_int}.log`
4. **Parse Logs**: Parses log entries using the `**` delimiter format
5. **Check IP Status**: Uses existing IP blocking cache to determine if IP should be blocked
6. **Store Data**: Saves parsed logs and IP information to database
7. **Update Statistics**: Maintains real-time country and ASN statistics

## Cron Jobs

- **Log Processing**: Every 2 minutes (`*/2 * * * *`)
- **Log Cleanup**: Every 5 minutes (`*/5 * * * *`)

## Log Format

The system expects logs in the following format:
```
IP**TIMESTAMP**DOMAIN**REQUEST_METHOD REQUEST_PATH**STATUS_CODE**RESPONSE_TIME**USER_AGENT
```

Example:
```
5.31.231.158**[27/Aug/2025:07:55:05 +0000]**xvi-4.morsmordre.org**GET /live/6068858058/5997547890/302675.ts?token=...**302**5**-**x-exo/1.0.0**0.000
```

## Dashboard Features

- **Real-time Statistics**: Live updates of blocked IP counts
- **Country View**: Browse blocked IPs by country
- **ASN View**: Browse blocked IPs by Autonomous System Number
- **IP Details**: View individual IP information and request counts
- **Log Viewer**: Display detailed log entries for selected IPs
- **Auto-refresh**: Automatic data refresh every 30 seconds

## Configuration

### Database Connection
The system supports MySQL/MariaDB with configurable connection parameters through environment variables.

### Log Processing
- **Timeout**: 10 seconds for log fetching
- **Batch Processing**: Processes multiple nodes concurrently with rate limiting
- **Duplicate Prevention**: Uses timestamp tracking to avoid processing duplicate log entries

## Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Verify database credentials in `.env` file
   - Ensure MySQL service is running
   - Check database permissions

2. **Log Fetching Failed**
   - Verify network access to CDN nodes
   - Check if port 29876 is accessible
   - Verify node IP addresses are correct

3. **No Data Displayed**
   - Check if cron jobs are running
   - Verify database tables are created
   - Check application logs for errors

### Logs
The application logs all activities to the console. Monitor these logs for:
- Database connection status
- Log processing progress
- Error messages and stack traces
- Cron job execution status

## Development

### Adding New Features
1. Extend the database schema in `database.js`
2. Add new API endpoints in `app.js`
3. Update the frontend interface in `public/index.html`
4. Test thoroughly before deployment

### Testing
```bash
# Test database connection
node -e "require('./database').connectToDatabase().then(console.log).catch(console.error)"

# Test IP lookup
node fetchAndCacheIP.js 8.8.8.8

# Test log processing
node logProcessor.js
```

## License

This project is licensed under the ISC License.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review application logs
3. Verify configuration settings
4. Create an issue in the repository

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

---

**Note**: This system is designed for production use with proper security measures. Ensure your database and network are properly secured before deployment. 