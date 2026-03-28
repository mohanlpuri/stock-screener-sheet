exports.handler = async function(event) {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  try {
    const body = JSON.parse(event.body)
    const { maxPrice, marketCap, minVolume } = body
    const token = process.env.FINNHUB_API_KEY

    // Volume minimum map
    const volumeMap = { any: 0, '100k': 100000, '500k': 500000, '1m': 1000000, '5m': 5000000 }
    const minVol = volumeMap[minVolume] || 0

    // Market cap range in millions
    let capMin = 0
    let capMax = 99999999
    if (marketCap === 'small') { capMin = 0;     capMax = 2000  }
    if (marketCap === 'mid')   { capMin = 2000;   capMax = 10000 }
    if (marketCap === 'large') { capMin = 10000;  capMax = 99999999 }

    // Step 1 — Get symbol list and filter to clean common stocks only
    const symbolsRes = await fetch(
      'https://finnhub.io/api/v1/stock/symbol?exchange=US&token=' + token
    )
    const allSymbols = await symbolsRes.json()

    const cleanSymbols = allSymbols.filter(s =>
      s.type === 'Common Stock' &&
      s.symbol &&
      s.symbol.length <= 4 &&
      !s.symbol.includes('.') &&
      !s.symbol.includes('-') &&
      !s.symbol.includes('^')
    )

    // Step 2 — Process in small batches of 10 to respect rate limits
    const results = []
    const batchSize = 10

    for (let i = 0; i < cleanSymbols.length && results.length < 25; i += batchSize) {
      const batch = cleanSymbols.slice(i, i + batchSize)

      // Fetch all three endpoints for each stock in batch simultaneously
      const batchResults = await Promise.all(
        batch.map(async function(stock) {
          try {
            const [quoteRes, profileRes, finRes] = await Promise.all([
              fetch('https://finnhub.io/api/v1/quote?symbol=' + stock.symbol + '&token=' + token),
              fetch('https://finnhub.io/api/v1/stock/profile2?symbol=' + stock.symbol + '&token=' + token),
              fetch('https://finnhub.io/api/v1/stock/metric?symbol=' + stock.symbol + '&metric=all&token=' + token)
            ])

            const [quote, profile, fin] = await Promise.all([
              quoteRes.json(),
              profileRes.json(),
              finRes.json()
            ])

            const metrics = fin.metric || {}
            const price = quote.c
            const volume = quote.v || 0
            const cap = profile.marketCapitalization || 0

            // Apply all filters
            if (!price || price <= 0) return null
            if (price > maxPrice) return null
            if (cap < capMin || cap > capMax) return null
            if (volume < minVol) return null

            return {
              ticker: stock.symbol,
              name: profile.name || stock.description || stock.symbol,
              price: price,
              marketCap: cap,
              volume: volume,
              sector: profile.finnhubIndustry || 'Unknown',
              week52High: metrics['52WeekHigh'] || null,
              week52Low: metrics['52WeekLow'] || null,
              peRatio: metrics['peBasicExclExtraTTM'] || null,
              bookValue: metrics['bookValuePerShareQuarterly'] || null
            }

          } catch(e) {
            return null
          }
        })
      )

      // Add valid results from this batch
      const validBatch = batchResults.filter(Boolean)
      results.push(...validBatch)

      // Small pause between batches to respect rate limits
      if (results.length < 25 && i + batchSize < cleanSymbols.length) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ stocks: results.slice(0, 25) })
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