export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export class AsyncQueue<T> {
  private values: T[] = [];
  private waiters: { resolve: (value: T | null) => void; cleanup: () => void }[] = [];
  private ended = false;
  private bytes = 0;

  constructor(private sizeOf: (value: T) => number = () => 1) {}

  push(value: T) {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.cleanup();
      waiter.resolve(value);
    } else {
      this.values.push(value);
      this.bytes += this.sizeOf(value);
    }
  }

  get size() { return this.bytes; }

  next(signal?: AbortSignal): Promise<T | null> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const value = this.values.shift();
    if (value !== undefined) {
      this.bytes -= this.sizeOf(value);
      return Promise.resolve(value);
    }
    if (this.ended) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const waiter = { resolve, cleanup: () => signal?.removeEventListener("abort", abort) };
      const abort = () => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(signal?.reason);
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.waiters.push(waiter);
    });
  }

  end() {
    this.ended = true;
    this.values = [];
    this.bytes = 0;
    for (const waiter of this.waiters.splice(0)) {
      waiter.cleanup();
      waiter.resolve(null);
    }
  }
}
