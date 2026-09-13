/** Stored timestamps without an offset (SQLite space or ISO T) are UTC, never device-local time. */
function timestampEpoch(value?: string | null): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?([zZ]|[+-]\d{2}:?\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", fraction = "", zone = "Z"] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] || hour > 23 || minute > 59 || second > 59) return null;

  let offsetMinutes = 0;
  if (zone.toUpperCase() !== "Z") {
    const compactZone = zone.replace(":", "");
    const offsetHours = Number(compactZone.slice(1, 3));
    const offsetRemainder = Number(compactZone.slice(3, 5));
    if (offsetHours > 23 || offsetRemainder > 59) return null;
    offsetMinutes = (offsetHours * 60 + offsetRemainder) * (zone[0] === "+" ? 1 : -1);
  }
  const date = new Date(0);
  // setUTCFullYear avoids Date.UTC's special interpretation of years 00–99.
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, Number(fraction.padEnd(3, "0").slice(0, 3)));
  return date.getTime() - offsetMinutes * 60_000;
}

/** Display a save timestamp in Korea Standard Time; a business date is not a save timestamp. */
export function formatHistoryTimestamp(value?: string | null): string {
  const epoch = timestampEpoch(value);
  if (epoch === null) return "";
  const date = new Date(epoch + 9 * 60 * 60_000);
  const year = date.getUTCFullYear();
  if (year < 1 || year > 9999) return "";
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${String(year).padStart(4, "0")}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** Keep business-date order untouched while selecting the most recently saved record. */
export function latestSavedListingEvent<T extends {
  work_updated_at?: string | null;
  created_at?: string | null;
  event_date?: string | null;
}>(events: readonly T[]): T | undefined {
  let latest = events[0];
  let latestEpoch: number | null = null;
  for (const event of events) {
    const epoch = timestampEpoch(event.work_updated_at) ?? timestampEpoch(event.created_at);
    if (epoch !== null && (latestEpoch === null || epoch > latestEpoch)) {
      latest = event;
      latestEpoch = epoch;
    }
  }
  return latest;
}
