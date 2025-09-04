require("dotenv").config();
const start_time = process.env.START_TIME? process.env.START_TIME: 2;
const end_time = process.env.END_TIME ? process.env.END_TIME : 5;

exports.createDateFromString = (dateString) => {
    const [datePart, timezone] = dateString.split(" ");
    const [fullDate, hours, minutes, seconds] = datePart.split(":");
    const [day, month, year] = fullDate.split("/");
  
    const months = {
      Jan: 0,
      Feb: 1,
      Mar: 2,
      Apr: 3,
      May: 4,
      Jun: 5,
      Jul: 6,
      Aug: 7,
      Sep: 8,
      Oct: 9,
      Nov: 10,
      Dec: 11,
    };
  
    const date = new Date(Date.UTC(year, months[month], day, hours, minutes, 0));
  
    if (timezone !== "+0000") {
      const tzOffset =
        parseInt(timezone.substring(1, 3), 10) * 60 +
        parseInt(timezone.substring(3, 5), 10);
      const offsetMillis =
        (timezone.startsWith("+") ? -1 : 1) * tzOffset * 60 * 1000;
      console.log(tzOffset);
      date.setTime(date.getTime() + offsetMillis);
    }
  
    return date;
  };

// Country to timezone mapping (major timezone for each country)
const countryTimezones = {
  'US': 'America/New_York',      // Eastern Time
  'GB': 'Europe/London',         // GMT/BST
  'UK': 'Europe/London',         // GMT/BST (alias for GB)  
  'ZY': 'Europe/London',         // GMT/BST
  'DE': 'Europe/Berlin',         // CET/CEST
  'NL': 'Europe/Amsterdam',      // CET/CEST
  'FR': 'Europe/Paris',          // CET/CEST
  'IT': 'Europe/Rome',           // CET/CEST
  'ES': 'Europe/Madrid',         // CET/CEST
  'CA': 'America/Toronto',       // Eastern Time
  'ZX': 'America/Toronto',       // Eastern Time (Canada alias)
  'AU': 'Australia/Sydney',      // AEST/AEDT
  'JP': 'Asia/Tokyo',            // JST
  'CN': 'Asia/Shanghai',         // CST
  'IN': 'Asia/Kolkata',          // IST
  'BR': 'America/Sao_Paulo',     // BRT
  'RU': 'Europe/Moscow',         // MSK
  'MX': 'America/Mexico_City',   // CST
  'KR': 'Asia/Seoul',            // KST
  'SG': 'Asia/Singapore',        // SGT
  'HK': 'Asia/Hong_Kong',        // HKT
  'TW': 'Asia/Taipei',           // CST
  'TH': 'Asia/Bangkok',          // ICT
  'ID': 'Asia/Jakarta',          // WIB
  'MY': 'Asia/Kuala_Lumpur',     // MYT
  'PH': 'Asia/Manila',           // PST
  'VN': 'Asia/Ho_Chi_Minh',      // ICT
  'ZA': 'Africa/Johannesburg',   // SAST
  'EG': 'Africa/Cairo',          // EET
  'NG': 'Africa/Lagos',          // WAT
  'KE': 'Africa/Nairobi',        // EAT
  'MA': 'Africa/Casablanca',     // WET
  'AR': 'America/Argentina/Buenos_Aires', // ART
  'CL': 'America/Santiago',      // CLT
  'CO': 'America/Bogota',        // COT
  'PE': 'America/Lima',          // PET
  'VE': 'America/Caracas',       // VET
  'NZ': 'Pacific/Auckland',      // NZST/NZDT
  'NO': 'Europe/Oslo',           // CET/CEST
  'SE': 'Europe/Stockholm',      // CET/CEST
  'DK': 'Europe/Copenhagen',     // CET/CEST
  'FI': 'Europe/Helsinki',       // EET/EEST
  'PL': 'Europe/Warsaw',         // CET/CEST
  'CZ': 'Europe/Prague',         // CET/CEST
  'HU': 'Europe/Budapest',       // CET/CEST
  'AT': 'Europe/Vienna',         // CET/CEST
  'CH': 'Europe/Zurich',         // CET/CEST
  'BE': 'Europe/Brussels',       // CET/CEST
  'PT': 'Europe/Lisbon',         // WET/WEST
  'IE': 'Europe/Dublin',         // GMT/IST
  'IS': 'Atlantic/Reykjavik',    // GMT
  'TR': 'Europe/Istanbul',       // TRT
  'GR': 'Europe/Athens',         // EET/EEST
  'IL': 'Asia/Jerusalem',        // IST/IDT
  'SA': 'Asia/Riyadh',           // AST
  'AE': 'Asia/Dubai',            // GST
  'QA': 'Asia/Qatar',            // AST
  'KW': 'Asia/Kuwait',           // AST
  'BH': 'Asia/Bahrain',          // AST
  'OM': 'Asia/Muscat',           // GST
  'JO': 'Asia/Amman',            // EET
  'LB': 'Asia/Beirut',           // EET
  'CY': 'Asia/Nicosia',          // EET/EEST
  'MT': 'Europe/Malta',          // CET/CEST
  'LU': 'Europe/Luxembourg',     // CET/CEST
  'SI': 'Europe/Ljubljana',      // CET/CEST
  'SK': 'Europe/Bratislava',     // CET/CEST
  'HR': 'Europe/Zagreb',         // CET/CEST
  'BG': 'Europe/Sofia',          // EET/EEST
  'RO': 'Europe/Bucharest',      // EET/EEST
  'LT': 'Europe/Vilnius',        // EET/EEST
  'LV': 'Europe/Riga',           // EET/EEST
  'EE': 'Europe/Tallinn',        // EET/EEST
  'UA': 'Europe/Kiev',           // EET/EEST
  'BY': 'Europe/Minsk',          // MSK
  'MD': 'Europe/Chisinau',       // EET/EEST
  'RS': 'Europe/Belgrade',       // CET/CEST
  'BA': 'Europe/Sarajevo',       // CET/CEST
  'ME': 'Europe/Podgorica',      // CET/CEST
  'MK': 'Europe/Skopje',         // CET/CEST
  'AL': 'Europe/Tirane',         // CET/CEST
  'XK': 'Europe/Pristina',       // CET/CEST
  'AD': 'Europe/Andorra',        // CET/CEST
  'MC': 'Europe/Monaco',         // CET/CEST
  'SM': 'Europe/San_Marino',     // CET/CEST
  'VA': 'Europe/Vatican',        // CET/CEST
  'LI': 'Europe/Vaduz',          // CET/CEST
  'ZZ': 'Europe/Madrid',         // CET/CEST
};

exports.isInNightTimeRange = (countryCode) => {
  const timezone = countryTimezones[countryCode];
  if (!timezone) {
    console.log(`No timezone found for country: ${countryCode}`);
    return false;
  }

  try {
    // Get current time in the country's timezone
    const now = new Date();
    const localTime = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
    console.log(localTime);
    const hour = localTime.getHours();
    // Check if it's between 2 AM and 5 AM
    return hour >= start_time && hour <= end_time;
    // return true
  } catch (error) {
    console.error(`Error getting time for country ${countryCode}:`, error);
    return false;
  }
};

  