import { describe, it, expect } from 'vitest';
import { createQueue } from '../src/core/queue.js';

describe('createQueue', () => {
  it('runs tasks strictly in order, never overlapping', async () => {
    const enqueue = createQueue();
    const order = [];
    let running = 0;
    const task = (id) => async () => {
      running += 1;
      expect(running).toBe(1); // never two at once
      await Promise.resolve();
      order.push(id);
      running -= 1;
    };
    await Promise.all([enqueue(task('a')), enqueue(task('b')), enqueue(task('c'))]);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('a rejected task does not wedge the ones after it', async () => {
    const enqueue = createQueue();
    const bad = enqueue(() => Promise.reject(new Error('boom')));
    await expect(bad).rejects.toThrow('boom');
    await expect(enqueue(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('a later task sees the effect of an earlier one', async () => {
    const enqueue = createQueue();
    let shared = 0;
    enqueue(async () => {
      await Promise.resolve();
      shared = 1;
    });
    const second = await enqueue(async () => shared + 1);
    expect(second).toBe(2);
  });
});
