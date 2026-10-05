export interface TimeZoneOption {
  id: string;
  city: string;
  region: string;
  offsetMinutes: number;
  offsetLabel: string;
  searchText: string;
}

const modernCityNames: Record<string, string> = {
  Calcutta: "Kolkata",
  Kiev: "Kyiv",
  Saigon: "Ho Chi Minh City",
  Rangoon: "Yangon",
  Katmandu: "Kathmandu",
  Asmera: "Asmara",
  Godthab: "Nuuk",
};

function getOffsetMinutes(timeZone: string, date: Date) {
  const offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;

  const match = offset?.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

function formatOffset(offsetMinutes: number) {
  if (offsetMinutes === 0) return "GMT+0";
  const sign = offsetMinutes > 0 ? "+" : "-";
  const hours = Math.floor(Math.abs(offsetMinutes) / 60);
  const minutes = Math.abs(offsetMinutes) % 60;
  return `GMT${sign}${hours}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}`;
}

function offsetSearchTerms(offsetMinutes: number) {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const hours = Math.floor(Math.abs(offsetMinutes) / 60);
  const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
  const padded = `${sign}${String(hours).padStart(2, "0")}:${minutes}`;
  const short = minutes === "00" ? `${sign}${hours}` : `${sign}${hours}:${minutes}`;
  return [`gmt${short}`, `utc${short}`, `gmt${padded}`, `utc${padded}`, short, padded].join(" ");
}

function describeTimeZone(id: string, date: Date, utcLabel: string): TimeZoneOption {
  const segments = id.split("/");
  const idCity = segments[segments.length - 1].replace(/_/g, " ");
  const city = id === "UTC" ? "UTC" : (modernCityNames[idCity] ?? idCity);
  const region = id === "UTC" ? utcLabel : segments.slice(0, -1).join(" / ").replace(/_/g, " ");
  const offsetMinutes = id === "UTC" ? 0 : getOffsetMinutes(id, date);
  const offsetLabel = formatOffset(offsetMinutes);

  return {
    id,
    city,
    region,
    offsetMinutes,
    offsetLabel,
    searchText: `${city} ${idCity} ${region} ${id} ${offsetSearchTerms(offsetMinutes)}`,
  };
}

export function getTimeZoneOptions(localTimeZone: string, utcLabel: string, date = new Date()) {
  const ids = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const options = ids
    .filter((id) => id !== "UTC" && id !== localTimeZone)
    .map((id) => describeTimeZone(id, date, utcLabel))
    .sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.city.localeCompare(b.city));

  const pinned = [describeTimeZone("UTC", date, utcLabel)];
  if (localTimeZone && localTimeZone !== "UTC") pinned.push(describeTimeZone(localTimeZone, date, utcLabel));
  return [...pinned, ...options];
}
