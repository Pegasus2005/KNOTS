import type { ModelProvider, ModelRequest } from '@knots/types';
import type { KnotsCore } from '../index.js';

/** A durable command consumed by the owning worker, including from a separate CLI process. */
export function requestWorkerStop(core: KnotsCore): void {
  core.database.getDb().transaction(() => {
    core.settings.set('worker_dispatch_enabled', 'false');
    core.settings.set(
      'worker_stop_generation',
      String(Number(core.settings.get('worker_stop_generation') ?? 0) + 1),
    );
  })();
}

/** Legacy CLI entry points share dispatch/stop control even before migrating to durable jobs. */
export function controlledProvider(core: KnotsCore, provider: ModelProvider): ModelProvider {
  function scope(request: ModelRequest) {
    const controller = new AbortController();
    const generation = core.settings.get('worker_stop_generation') ?? '0';
    const abort = () => controller.abort(request.signal?.reason);
    const check = () => {
      if (
        core.settings.get('worker_dispatch_enabled') === 'false' ||
        (core.settings.get('worker_stop_generation') ?? '0') !== generation
      )
        controller.abort(new Error('Stopped by the global stop control'));
    };
    request.signal?.addEventListener('abort', abort, { once: true });
    if (request.signal?.aborted) abort();
    check();
    const timer = setInterval(check, 100);
    return {
      signal: controller.signal,
      check,
      close: () => {
        clearInterval(timer);
        request.signal?.removeEventListener('abort', abort);
      },
    };
  }
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    getCapabilities: (model) => provider.getCapabilities(model),
    listModels: () => provider.listModels(),
    testConnection: () => provider.testConnection(),
    async *sendMessage(request) {
      const control = scope(request);
      try {
        control.signal.throwIfAborted();
        for await (const chunk of provider.sendMessage({ ...request, signal: control.signal })) {
          control.check();
          control.signal.throwIfAborted();
          yield chunk;
        }
        control.check();
        control.signal.throwIfAborted();
      } finally {
        control.close();
      }
    },
    async sendMessageSync(request) {
      const control = scope(request);
      try {
        control.signal.throwIfAborted();
        const result = await provider.sendMessageSync({ ...request, signal: control.signal });
        control.check();
        control.signal.throwIfAborted();
        return result;
      } finally {
        control.close();
      }
    },
  };
}
