/** Simple async pull queue: producers push(), a single consumer iterates with for-await. */
export class AsyncQueue<T> {
  private items: T[] = [];
  private waiters: Array<(item: T) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter(item);
    else this.items.push(item);
  }

  close(): void {
    this.closed = true;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, unknown> {
    while (true) {
      if (this.items.length > 0) {
        yield this.items.shift()!;
        continue;
      }
      if (this.closed) return;
      const item = await new Promise<T | null>((resolve) => {
        this.waiters.push((v) => resolve(v));
        if (this.closed) resolve(null);
      });
      if (item === null) return;
      yield item;
    }
  }
}
