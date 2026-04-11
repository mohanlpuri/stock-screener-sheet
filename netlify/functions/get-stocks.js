exports.handler = async function(event) {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  try {
    const body = JSON.parse(event.body)
    const { maxPrice, marketCap, minVolume, customTickers } = body

    const volumeMap = { any: 0, '100k': 100000, '500k': 500000, '1m': 1000000, '5m': 5000000 }
    const minVol = volumeMap[minVolume] || 0

    let capMin = 0
    let capMax = 99999999999999
    if (marketCap === 'small') { capMin = 0;             capMax = 2000000000    }
    if (marketCap === 'mid')   { capMin = 2000000000;    capMax = 10000000000   }
    if (marketCap === 'large') { capMin = 10000000000;   capMax = 99999999999999 }

    // Fetch tickers from Google Sheet
    const sheetUrl = 'https://docs.google.com/spreadsheets/d/1Sk8vQ6Hf_i64mCCYVypAWrjj7peJQ-e6Fu62kjgH__Q/edit?gid=0#gid=0&single=true&output=csv'
    const sheetRes = await fetch(sheetUrl)
    const csvText = await sheetRes.text()

    const defaultTickers = csvText
      .split('\n')                          // one ticker per row
      .map(t => t.trim().toUpperCase())     // clean whitespace
      .filter(t => t.length > 0 && t !== 'TICKER') // skip empty rows & header
      .filter((v, i, a) => a.indexOf(v) === i)      // deduplicate

    const tickers = (customTickers && customTickers.length > 0)
      ? customTickers
      : defaultTickers

    // Step 1 — get crumb and cookie from Yahoo Finance
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    })
    const crumb = await crumbRes.text()
    const cookies = crumbRes.headers.get('set-cookie') || ''

    // Step 2 — fetch all quotes in one call
    const symbols = tickers.join(',')
    const url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + symbols +
                '&crumb=' + encodeURIComponent(crumb)

    const quotesRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Cookie': cookies
      }
    })

    const data = await quotesRes.json()
    const quotes = data?.quoteResponse?.result || []

    const results = quotes
      .filter(q => {
        if (!q) return false
        const price = q.regularMarketPrice
        const cap = q.marketCap || 0
        const vol = q.averageDailyVolume3Month || 0
        if (!price || price <= 0) return false
        if (price > maxPrice) return false
        if (cap < capMin || cap > capMax) return false
        if (vol < minVol) return false
        return true
      })
      .slice(0, 25)
      .map(q => ({
        ticker: q.symbol,
        name: q.shortName || q.symbol,
        price: q.regularMarketPrice,
        marketCap: q.marketCap,
        volume: q.averageDailyVolume3Month || 0,
        sector: q.sector || 'Unknown',
        week52High: q.fiftyTwoWeekHigh || null,
        week52Low: q.fiftyTwoWeekLow || null,
        peRatio: q.trailingPE || null,
        bookValue: q.bookValue || null,
        analystRating: q.averageAnalystRating || null,
        analystCount: q.numberOfAnalystOpinions || null
      }))

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ stocks: results })
    }

  } catch(e) {
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: e.message })
    }
  }

}