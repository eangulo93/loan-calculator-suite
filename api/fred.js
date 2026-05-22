export default async function handler(req, res) {
  const { series } = req.query;
  const FRED_KEY = "15324c2be136ca5331844402e6a2aa59";

  try {
    const response = await fetch(
      `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${FRED_KEY}&limit=1&sort_order=desc&file_type=json`
    );
    const data = await response.json();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch" });
  }
}