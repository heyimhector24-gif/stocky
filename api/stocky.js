// Runs only on Vercel's servers. The API key never reaches the browser.

const SYSTEM_RULES = `You never give buy, sell, or hold recommendations. You describe what is happening and why, in plain language. If you are not confident about a piece of data, say so rather than guessing.`;

async function callClaude(body) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Server is not configured with an API key yet.');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error('Model request failed: ' + errText);
  }
  return response.json();
}

function extractText(data) {
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

function parseJSON(text) {
  let clean = text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  try { return JSON.parse(clean); }
  catch (e) {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Could not parse model output as JSON.');
  }
}

function langInstruction(lang) {
  return lang === 'zh-TW'
    ? 'Respond in Traditional Chinese (Taiwan/Hong Kong style, 繁體中文) for ALL text fields — headlines, summaries, reasons, notes, everything. Company/ticker names can stay in English.'
    : 'Respond in English for all text fields.';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action, lang } = req.body || {};
    const language = lang === 'zh-TW' ? 'zh-TW' : 'en';

    if (action === 'pulse') {
      const prompt = `You have web search available. Search for current real market data:

1. The S&P 500's current value and today's percent change.
2. Three macro stats with current values and today's percent change: US 10-Year Treasury Yield, US Dollar Index (DXY), CBOE Volatility Index (VIX).
3. Six large-cap stocks making notable moves right now (real tickers, real current percent change, found via search) — each with a short plain-English note (under 12 words) on why it's moving, purely descriptive, never a signal to act on.
4. 2-3 real, current general market news items (real headline, real source, real URL from search results).

For each of the above, also estimate a short recent relative trajectory as an array of numbers 0-100 (roughly reflecting the shape of recent movement, clearly an estimate, not certified tick data): for the S&P give 24 numbers (recent trajectory), for each macro stat give 8 numbers, for each mover no sparkline needed.

${langInstruction(language)}
${SYSTEM_RULES}

Respond with ONLY raw JSON, no markdown fences:
{"indexSnapshot":{"value":5900.0,"changePct":0.2,"sparkline":[24 numbers 0-100]},"macroStats":[{"label":"US 10Y Yield","value":"4.21%","changePct":-0.3,"sparkline":[8 numbers 0-100]},{"label":"US Dollar Index (DXY)","value":"101.3","changePct":0.1,"sparkline":[8 numbers 0-100]},{"label":"CBOE Volatility Index (VIX)","value":"14.2","changePct":-2.1,"sparkline":[8 numbers 0-100]}],"movers":[{"ticker":"TICKER","name":"Company Name","changePct":1.2,"note":"short plain note"}],"news":[{"headline":"string","source":"string","url":"https://real-url","summary":"string"}]}`;

      const data = await callClaude({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      });
      return res.status(200).json(parseJSON(extractText(data)));
    }

    if (action === 'market') {
      const { tickers } = req.body;
      if (!Array.isArray(tickers) || tickers.length === 0) {
        return res.status(400).json({ error: 'No tickers provided.' });
      }
      const prompt = `You have web search available. For these tickers: ${tickers.join(', ')} — look up each one's actual current price and today's percent change using web search, do not estimate from memory. Also classify each ticker into ONE broad sector, and give a rough volatility score 0-100 (clearly an estimate).

Then, across this whole list, identify 1-4 genuine hidden-overlap clusters: cases where two or more of these specific tickers share real underlying risk that isn't obvious from the company names alone. For each cluster give: a confidence level (High/Medium/Low — how certain this overlap really is), the specific named shared mechanism (the actual company, facility, supply chain, or economic driver involved — e.g. "Both depend on TSMC's advanced-node fabs in Taiwan," not just "both are tech"), and 1-2 REAL current news items found via web search about that shared mechanism itself (real headline, real source, real URL from your search results, one factual summary sentence) — not generic news about each ticker individually. Omit a cluster entirely if you find no genuine overlap; do not invent weak connections just to have something to show.

For any ticker with a real, notable recent pullback from a peak, include a recovery-context note (typical recovery time for similar past pullbacks).

Give a rough estimate of S&P 500 performance over 1 month, 6 months, 1 year, and a nominal "all time" window, clearly labeled as estimates.

${langInstruction(language)}
${SYSTEM_RULES}

Respond with ONLY raw JSON, no markdown fences:
{"prices":{"TICKER":{"name":"string","price":123.45,"changePct":1.2,"sector":"string","volatility":0}},"clusters":[{"label":["Two","Words"],"reason":"one plain sentence","mechanism":"specific named shared mechanism","confidence":"High|Medium|Low","tickers":["TICKER1","TICKER2"],"news":[{"headline":"string","source":"string","url":"https://real-url","summary":"one sentence"}]}],"recovery":[{"ticker":"TICKER","peak":150.0,"peakLabel":"string","recoveryNote":"string"}],"news":[{"headline":"string","source":"string","url":"https://real-url","summary":"string"}],"benchmark":{"oneMonthPct":1.2,"sixMonthPct":5.0,"oneYearPct":12.0,"allTimePct":30.0}}`;

      const data = await callClaude({
        model: 'claude-sonnet-4-6',
        max_tokens: 4500,
        messages: [{ role: 'user', content: prompt }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      });
      return res.status(200).json(parseJSON(extractText(data)));
    }

    if (action === 'ask') {
      const { question, holdings, digest } = req.body;
      if (!question) return res.status(400).json({ error: 'No question provided.' });

      const context = `The person's current holdings: ${JSON.stringify(holdings || [])}.\nRecent portfolio summary: ${digest || 'none available'}.`;
      const formatRules = `Format your answer as a short list of distinct points, not one dense paragraph. Each point: a bold 2-4 word label (wrap it like **Label**) followed by one concise sentence. Pull out any key numbers (percentages, dollar figures) and make them stand out clearly rather than burying them mid-sentence. Keep it scannable — 2-5 short points is usually enough, more only if genuinely needed.`;

      const data = await callClaude({
        model: 'claude-sonnet-4-6',
        max_tokens: 700,
        system: `You are Ask Stocky, grounded in the person's actual portfolio data below. ${SYSTEM_RULES}\n${formatRules}\n${langInstruction(language)}\n\n${context}`,
        messages: [{ role: 'user', content: question }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      });
      return res.status(200).json({ answer: extractText(data) });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
