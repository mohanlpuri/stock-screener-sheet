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

    const defaultTickers = [
      // Banks & Financial
      'BAC','WFC','C','USB','FITB','RF','KEY','HBAN','CFG','MTB',
      // Energy
      'T','VALE','PBR','RIG','NOK','ABEV','ITUB','SLB','HAL','MRO',
      // Technology
      'INTC','ERIC','BB','SNAP','CSCO','HPQ','JNPR','AMD','DELL',
      // Healthcare
      'PFE','KVUE','OGN','WBA','BHC','VTRS','PRGO',
      // Consumer & Airlines
      'F','GM','AAL','UAL','DAL','CCL','NCLH','M','KSS','GPS',
      // REITs
      'NLY','AGNC','MPW','IVR','TWO','MFA','STWD','BXMT','RITM',
      // Media & Telecom
      'VZ','SIRI','PARA','WBD','LUMN',
      // Mining & Materials
      'GOLD','NEM','KGC','HL','PAAS','AG','EXK','TECK','FCX',
      // Clean energy
      'PLUG','BE','FCEL','SPWR','RUN','NOVA',
      // Diversified
      'GE','DVN','OVV','CIVI','SM','NOG','CHK','AR'
    ].filter((v, i, a) => a.indexOf(v) === i)

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
        analystCount: q.numberOfAnalystOpinions || null,
        dividendYield: q.trailingAnnualDividendYield || null
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