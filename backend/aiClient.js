const DEFAULT_URL = process.env.OAI_URL || process.env.OLLAMA_URL || 'http://127.0.0.1:11434/v1/completions';
const DEFAULT_MODEL = process.env.AI_MODEL || process.env.OLLAMA_MODEL || 'qwen2.5-coder:1.5b';

async function callModel(prompt, modelName) {
  if (!prompt) throw new Error('Prompt is required');
  const model = modelName || DEFAULT_MODEL;
  // Allow the URL to already include query params
  const base = DEFAULT_URL;
  const url = base;

  const payload = { model, prompt };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  // Read as text first to avoid "Body has already been read" errors,
  // then try to parse JSON.
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch (e) { body = text; }

  if (!res.ok) {
    const msg = (body && body.error) ? body.error : `AI service error ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return body;
}

module.exports = { callModel };
