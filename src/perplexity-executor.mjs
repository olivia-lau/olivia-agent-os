const ENDPOINT = 'https://api.perplexity.ai/v1/responses';
let sessionApiKey = '';

export function setSessionPerplexityKey(value) {
  const key = String(value || '').trim();
  if (!key || key.length > 1000 || /\s/.test(key)) throw new Error('Enter a valid Perplexity API key.');
  sessionApiKey = key;
}

export function clearSessionPerplexityKey() { sessionApiKey = ''; }
export function hasSessionPerplexityKey() { return Boolean(sessionApiKey); }

export async function runPerplexity(prompt, { onProgress = () => {}, apiKey = sessionApiKey || process.env.PERPLEXITY_API_KEY, timeoutMs = 180000, fetchImpl = fetch } = {}) {
  if (!apiKey) return { ok: false, output: '', stdout: '', stderr: 'Perplexity API credential is not configured.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let answer = '';
  const citations = new Set();
  let lastProgressAt = 0;
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'fast', input: prompt, stream: true }),
      signal: controller.signal
    });
    if (!response.ok) {
      const error = (await response.text()).slice(0, 2000);
      return { ok: false, output: '', stdout: '', stderr: `Perplexity HTTP ${response.status}: ${error}` };
    }
    if (!response.body) return { ok: false, output: '', stdout: '', stderr: 'Perplexity returned no response stream.' };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let eventLines = [];
    const captureSources = item => {
      if (item?.type !== 'search_results' || !Array.isArray(item.results)) return;
      for (const result of item.results) {
        if (typeof result?.url === 'string' && /^https?:\/\//.test(result.url)) citations.add(result.url);
      }
    };
    const handleEvent = () => {
      if (!eventLines.length) return;
      const payload = eventLines.join('\n');
      eventLines = [];
      if (payload === '[DONE]') return;
      let event;
      try { event = JSON.parse(payload); } catch { return; }
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
        answer += event.delta;
        if (Date.now() - lastProgressAt >= 350) {
          onProgress({ kind: 'answer', text: answer.slice(-600) });
          lastProgressAt = Date.now();
        }
      }
      if (event.type === 'response.output_item.done') captureSources(event.item);
      if (event.type === 'response.completed') {
        for (const item of event.response?.output || []) captureSources(item);
        if (!answer.trim() && typeof event.response?.output_text === 'string') answer = event.response.output_text;
      }
      if (event.type === 'response.failed') throw new Error(event.response?.error?.message || 'Perplexity request failed.');
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) {
        if (line === '') handleEvent();
        else if (line.startsWith('data:')) eventLines.push(line.slice(5).trimStart());
      }
    }
    pending += decoder.decode();
    if (pending.startsWith('data:')) eventLines.push(pending.slice(5).trimStart());
    handleEvent();
    if (answer.trim()) onProgress({ kind: 'answer', text: answer.slice(-600) });
    const sources = citations.size ? `\n\nSources:\n${[...citations].map((url, index) => `${index + 1}. ${url}`).join('\n')}` : '';
    return { ok: Boolean(answer.trim()), output: `${answer.trim()}${sources}`, stdout: answer, stderr: answer.trim() ? '' : 'Perplexity returned no answer.' };
  } catch (error) {
    return { ok: false, output: answer, stdout: answer, stderr: error.name === 'AbortError' ? 'Perplexity request timed out.' : error.message, timedOut: error.name === 'AbortError' };
  } finally {
    clearTimeout(timer);
  }
}
