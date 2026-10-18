/**
 * Run async tasks one at a time, in the order they were queued.
 *
 * A chrome.storage write is read-modify-write: load the whole map, change one
 * entry, set it back. Two of those in flight at once both read the old map, and
 * the second set clobbers the first - so a quick second tag or a rapid save/
 * un-save can silently lose the first. A per-store queue makes each write see
 * the result of the one before it.
 */
export function createQueue() {
  let tail = Promise.resolve();
  return function enqueue(task) {
    const run = tail.then(task, task);
    // Keep the chain alive even if a task rejects, so one failure does not wedge
    // every later write behind it.
    tail = run.then(
      () => {},
      () => {},
    );
    return run;
  };
}
