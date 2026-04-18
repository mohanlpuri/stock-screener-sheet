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

    // Split tickers into batches of 20
    const batchSize = 20
    const batches = []
    for (let i = 0; i < tickers.length; i += batchSize) {
      batches.push(tickers.slice(i, i + batchSize))
    }
    console.log('Total batches:', batches.length)

    // Fetch each batch with a small delay between requests
    const allQuotes = []
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      const symbols = batch.join(',')
      const url = `https://query2.finance.yahoo.com/v8/finance/quote?symbols=${symbols}&fields=symbol,shortName,regularMarketPrice,marketCap,averageDailyVolume3Month,fiftyTwoWeekHigh,fiftyTwoWeekLow,trailingPE,bookValue,averageAnalystRating,numberOfAnalystOpinions,trailingAnnualDividendYield`

      try {
        const quotesRes = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Origin': 'https://finance.yahoo.com',
            'Referer': 'https://finance.yahoo.com/screener',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-site'
          }
        })

        console.log('Batch', i + 1, 'status:', quotesRes.status)

        if (quotesRes.ok) {
          const data = await quotesRes.json()
          const quotes = data?.quoteResponse?.result || []
          console.log('Batch', i + 1, 'quotes:', quotes.length)
          allQuotes.push(...quotes)
        }
      } catch(batchErr) {
        console.log('Batch', i + 1, 'error:', batchErr.message)
      }

      // Small delay between batches to avoid rate limiting
      if (i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }

    console.log('Total quotes fetched:', allQuotes.length)

    const results = allQuotes
      .filter(q => {
        if (!q) return false
        const price = q.regularMarketPrice
        const cap = q.marketCap || 0
        const vol = q.averageDailyVolume3Month || null
        if (!price || price <= 0) return false
        if (price > maxPrice) return false
        if (cap < capMin || cap > capMax) return false
        if (minVol > 0 && vol !== null && vol < minVol) return false
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