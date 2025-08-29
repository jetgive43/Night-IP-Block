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

  