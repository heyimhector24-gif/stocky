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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action } = req.body || {};

    if (action === 'market') {
      const { tickers } = req.body;
      if (!Array.isArray(tickers) || tickers.length === 0) {
        return res.status(400).json({ error: 'No tickers provided.' });
      }
      const prompt = `You have web search available. For these tickers: ${tickers.join(', ')} — look up each one's actual current price and today's percent change using web search, do not estimate from memory.

Then, across this whole list, identify 1-4 genuine hidden-overlap clusters: cases where two or more of these specific tickers share real underlying risk (same supply chain, same sector demand driver, same macro exposure) that isn't obvious from the company names alone. Omit clusters if you find none — do not invent weak connections.

For any ticker with a real, notable recent pullback from a peak, include a recovery-context note describing how long similar past pullbacks for that stock or its sector have typically taken to recover, in plain language.

${SYSTEM_RULES}

Respond with ONLY raw JSON, no markdown fences, in this exact shape:
{"prices":{"TICKER":{"name":"Company Name","price":123.45,"changePct":1.2}},"clusters":[{"label":["Two","Words"],"reason":"one plain sentence describing the shared risk","tickers":["TICKER1","TICKER2"]}],"recovery":[{"ticker":"TICKER","peak":150.0,"peakLabel":"May high","recoveryNote":"plain sentence on typical recovery time"}]}`;

      const data = await callClaude({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      });
      const parsed = parseJSON(extractText(data));
      return res.status(200).json(parsed);
    }

    if (action === 'ask') {
      const { question, holdings, digest } = req.body;
      if (!question) return res.status(400).json({ error: 'No question provided.' });

      const context = `The person's current holdings: ${JSON.stringify(holdings || [])}.\nRecent portfolio summary: ${digest || 'none available'}.`;
      const data = await callClaude({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: `You are Ask Stocky, grounded in the person's actual portfolio data below. Answer their question using this real data. ${SYSTEM_RULES}\n\n${context}`,
        messages: [{ role: 'user', content: question }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      });
      const answer = extractText(data);
      return res.status(200).json({ answer });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
