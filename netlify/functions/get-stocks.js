exports.handler = async function(event) {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  try {
    const body = JSON.parse(event.body)
    const { maxPrice, marketCap, minVolume } = body

    // Step 1 — Get list of US stocks from Finnhub
    const symbolsRes = await fetch(
      'https://finnhub.io/api/v1/stock/symbol?exchange=US&token=' + process.env.FINNHUB_API_KEY
    )
    const symbols = await symbolsRes.json()

    // Take first 200 symbols to screen
    const sample = symbols.slice(0, 200)

    // Step 2 — Fetch data for each stock
    const results = []

    for (const stock of sample) {
      try {

        // Get current price quote
        const quoteRes = await fetch(
          'https://finnhub.io/api/v1/quote?symbol=' + stock.symbol +
          '&token=' + process.env.FINNHUB_API_KEY
        )
        const quote = await quoteRes.json()

        // Get company profile for sector and market cap
        const profileRes = await fetch(
          'https://finnhub.io/api/v1/stock/profile2?symbol=' + stock.symbol +
          '&token=' + process.env.FINNHUB_API_KEY
        )
        const profile = await profileRes.json()

        // Get basic financials for 52W high/low, P/E, book value
        const finRes = await fetch(
          'https://finnhub.io/api/v1/stock/metric?symbol=' + stock.symbol +
          '&metric=all&token=' + process.env.FINNHUB_API_KEY
        )
        const fin = await finRes.json()
        const metrics = fin.metric || {}

        const price = quote.c
        const volume = quote.v
        const cap = profile.marketCapitalization
        const sector = profile.finnhubIndustry || 'Unknown'

        // Skip if missing price data
        if (!price || price <= 0) continue

        // Apply price filter
        if (price > maxPrice) continue

        // Apply market cap filter
        if (marketCap === 'small' && cap >= 2000) continue
        if (marketCap === 'mid' && (cap < 2000 || cap >= 10000)) continue
        if (marketCap === 'large' && cap < 10000) continue

        // Apply volume filter
        if (minVolume === '100k' && volume < 100000) continue
        if (minVolume === '500k' && volume < 500000) continue
        if (minVolume === '1m' && volume < 1000000) continue
        if (minVolume === '5m' && volume < 5000000) continue

        results.push({
          ticker: stock.symbol,
          name: profile.name || stock.description,
          price: price,
          marketCap: cap,
          volume: volume,
          sector: sector,
          week52High: metrics['52WeekHigh'] || null,
          week52Low: metrics['52WeekLow'] || null,
          peRatio: metrics['peBasicExclExtraTTM'] || null,
          bookValue: metrics['bookValuePerShareQuarterly'] || null
        })

        // Stop once we have 25 results
        if (results.length >= 25) break

      } catch(e) {
        continue
      }
    }

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