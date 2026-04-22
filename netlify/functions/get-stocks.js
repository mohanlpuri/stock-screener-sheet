exports.handler = async function(event) {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  try {
    const body = JSON.parse(event.body)
    const { maxPrice, marketCap, minVolume, customTickers } = body

    const apiKey = process.env.TWELVE_DATA_API_KEY
    console.log('API Key present:', apiKey ? 'yes, length=' + apiKey.length : 'NO - MISSING')

    const volumeMap = { any: 0, '100k': 100000, '500k': 500000, '1m': 1000000, '5m': 5000000 }
    const minVol = volumeMap[minVolume] || 0

    let capMin = 0
    let capMax = 99999999999999
    if (marketCap === 'small') { capMin = 0;           capMax = 2000000000     }
    if (marketCap === 'mid')   { capMin = 2000000000;  capMax = 10000000000    }
    if (marketCap === 'large') { capMin = 10000000000; capMax = 99999999999999 }

    // Fetch tickers from Google Sheet
    let defaultTickers = []
    try {
      const sheetUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR9MsSJjs2TpsnLkaaMzEQuEzjsDy6bxBiGVzEbuEcbulLBMTS7MU0y76GR_9yf5NcVbM7DlsilScWX/pub?gid=778242031&single=true&output=csv'
      const sheetRes = await fetch(sheetUrl)
      const csvText = await sheetRes.text()
      console.log('Sheet status:', sheetRes.status)

      defaultTickers = csvText
        .split('\n')
        .map(row => row.split(',')[0].trim().toUpperCase())
        .filter(t => t.length > 0 && t !== 'TICKER')
        .filter((v, i, a) => a.indexOf(v) === i)

      console.log('Tickers from sheet:', defaultTickers.length)
    } catch(sheetErr) {
      console.log('Sheet fetch failed, using fallback:', sheetErr.message)
      defaultTickers = [
        'BAC','WFC','C','USB','FITB','RF','KEY','HBAN','CFG','MTB',
        'T','VALE','PBR','RIG','NOK','ABEV','ITUB','SLB','HAL','MRO',
        'INTC','ERIC','BB','SNAP','CSCO','HPQ','JNPR','AMD','DELL',
        'PFE','KVUE','OGN','WBA','BHC','VTRS','PRGO',
        'F','GM','AAL','UAL','DAL','CCL','NCLH','M','KSS','GPS',
        'NLY','AGNC','MPW','IVR','TWO','MFA','STWD','BXMT','RITM',
        'VZ','SIRI','PARA','WBD','LUMN',
        'GOLD','NEM','KGC','HL','PAAS','AG','EXK','TECK','FCX',
        'PLUG','BE','FCEL','SPWR','RUN','NOVA',
        'GE','DVN','OVV','CIVI','SM','NOG','CHK','AR'
      ]
    }

    const tickers = (customTickers && customTickers.length > 0)
      ? customTickers
      : defaultTickers

    // Only fetch first 8 tickers (free plan limit per minute)
    const first8 = tickers.slice(0, 8)
    console.log('Fetching tickers:', first8.join(','))

    const symbols = first8.join(',')
    const url = `https://api.twelvedata.com/quote?symbol=${symbols}&apikey=${apiKey}`

    const res = await fetch(url)
    console.log('Status:', res.status)

    const data = await res.json()

    // Extract quotes from response
    const allQuotes = []
    if (first8.length === 1) {
      if (data && data.symbol && !data.code) {
        allQuotes.push(data)
      }
    } else {
      for (const ticker of first8) {
        const q = data[ticker]
        if (q && q.symbol && !q.code) {
          allQuotes.push(q)
        }
      }
    }

    console.log('Quotes fetched:', allQuotes.length)

    const results = allQuotes
      .filter(q => {
        if (!q) return false
        const price = parseFloat(q.close)
        const cap = parseFloat(q.market_cap) || 0
        const vol = parseFloat(q.average_volume) || null
        if (!price || price <= 0) return false
        if (price > maxPrice) return false
        if (cap < capMin || cap > capMax) return false
        if (minVol > 0 && vol !== null && vol < minVol) return false
        return true
      })
      .slice(0, 25)
      .map(q => ({
        ticker: q.symbol,
        name: q.name || q.symbol,
        price: parseFloat(q.close),
        marketCap: parseFloat(q.market_cap) || null,
        volume: parseFloat(q.average_volume) || 0,
        sector: q.sector || 'Unknown',
        week52High: q.fifty_two_week ? parseFloat(q.fifty_two_week.high) : null,
        week52Low: q.fifty_two_week ? parseFloat(q.fifty_two_week.low) : null,
        peRatio: parseFloat(q.pe) || null,
        bookValue: null,
        analystRating: null,
        analystCount: null,
        dividendYield: null
      }))

    console.log('Results count:', results.length)

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ stocks: results })
    }

  } catch(e) {
    console.log('Error:', e.message)
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
