// Explicit opt-in: only this synthetic prompt is sent. Never run by the default suite.
import { app } from 'electron';
import { createDefaultRegistry } from '@knots/providers';
const provider = process.env.KNOTS_LIVE_PROVIDER;
const model = process.env.KNOTS_LIVE_MODEL;
if (!provider || !model) {
  console.error('Set KNOTS_LIVE_PROVIDER and KNOTS_LIVE_MODEL to opt in.');
  app.exit(1);
} else
  void app
    .whenReady()
    .then(async () => {
      const token = process.env.KNOTS_LIVE_API_KEY;
      const adapter = createDefaultRegistry().createProvider(provider, {
        api_key: token,
        endpoint: process.env.KNOTS_LIVE_ENDPOINT,
        default_model: model,
      });
      const signal = AbortSignal.timeout(30000);
      let output = '';
      for await (const chunk of adapter.sendMessage({
        model,
        system: 'Return the single word READY.',
        messages: [{ role: 'user', content: 'Connectivity smoke test. Return READY.' }],
        max_tokens: 32,
        signal,
      })) {
        output += chunk.delta;
      }
      if (!output.trim()) throw new Error('Provider returned an empty response.');
      console.log(JSON.stringify({ provider, model, nonEmptyResponse: true }));
      app.quit();
    })
    .catch((error) => {
      console.error(error.message);
      app.exit(1);
    });
