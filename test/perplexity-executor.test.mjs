import test from 'node:test';
import assert from 'node:assert/strict';
import { runPerplexity } from '../src/perplexity-executor.mjs';

test('streams a Perplexity answer and retains citations', async () => {
  const progress = [];
  const fetchImpl = async (url, request) => {
    assert.equal(url, 'https://api.perplexity.ai/v1/responses');
    assert.deepEqual(JSON.parse(request.body), { preset: 'fast', input: 'Research this', stream: true });
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"Hello "}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"world"}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_item.done","item":{"type":"search_results","results":[{"url":"https://example.com/source"}]}}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      }
    }), { status: 200 });
  };
  const result = await runPerplexity('Research this', { apiKey: 'test-only', fetchImpl, onProgress: event => progress.push(event) });
  assert.equal(result.ok, true);
  assert.match(result.output, /Hello world/);
  assert.match(result.output, /https:\/\/example.com\/source/);
  assert.ok(progress.length > 0);
});

test('passes selected model, depth, and effort to Perplexity', async () => {
  const fetchImpl = async (url, request) => {
    assert.deepEqual(JSON.parse(request.body), { preset: 'high', model: 'perplexity/sonar', reasoning: { effort: 'low' }, input: 'Check', stream: true });
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"Done"}\n\n'));
      controller.close();
    } }), { status: 200 });
  };
  const result = await runPerplexity('Check', { apiKey: 'test-only', fetchImpl, preset: 'high', model: 'perplexity/sonar', effort: 'low' });
  assert.equal(result.ok, true);
});
