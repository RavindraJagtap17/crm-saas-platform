const logger = require("../utils/logger");

/**
 * Step 9A — minimal in-process job scheduler. Infrastructure only: no
 * business job is registered here (see index.js's header comment for
 * where future jobs plug in).
 *
 * Time handling: server-clock based (Date.now()/setInterval), the same
 * convention every other timestamp in this codebase already uses (e.g.
 * utils/logger.js's toISOString(), always UTC regardless of host
 * timezone) — no cron-string parsing, just "run every N ms". A future
 * job that genuinely needs a real calendar schedule (e.g. "once a day at
 * a specific hour") can still build that on top of this by checking the
 * current UTC time inside its own handler; this file only provides the
 * polling primitive.
 *
 * Single polling loop (one setInterval, not one timer per job) — clean
 * shutdown then only ever has one interval to clear, and adding jobs
 * never adds more OS timers.
 *
 * Concurrency: each job carries its own `running` flag, checked before
 * every tick considers it — this prevents a job from overlapping ITSELF
 * on this same process (e.g. a slow run still in flight when its next
 * due time arrives). This is a single-process app (see server.js) with
 * no clustering — nothing here coordinates across multiple instances;
 * running more than one instance of this process would need a real
 * distributed lock (e.g. a DB row lock), which is out of scope for this
 * step and not needed at the project's current scale.
 */

const jobs = new Map();
let tickHandle = null;
let tickIntervalMs = null;

function registerJob({ name, intervalMs, handler, enabled = true }) {
  if (!name || typeof name !== "string") {
    throw new Error("registerJob: name is required");
  }
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
    throw new Error(`registerJob: intervalMs must be a positive integer (job "${name}")`);
  }
  if (typeof handler !== "function") {
    throw new Error(`registerJob: handler must be a function (job "${name}")`);
  }
  if (jobs.has(name)) {
    throw new Error(`registerJob: a job named "${name}" is already registered`);
  }

  jobs.set(name, {
    name,
    intervalMs,
    handler,
    enabled,
    running: false,
    lastRunAt: null,
    lastDurationMs: null,
    lastStatus: null, // 'success' | 'failed' | null (never run)
    lastError: null,
  });
}

function unregisterJob(name) {
  jobs.delete(name);
}

// Snapshot for introspection/tests — never exposes the handler function
// or anything a job run might have captured in closure.
function listJobs() {
  return Array.from(jobs.values()).map(({ handler, ...rest }) => rest);
}

async function runJob(job) {
  if (job.running) {
    logger.warn(`Scheduler: skipped job "${job.name}" — previous run still in progress`);
    return;
  }
  job.running = true;
  const startedAt = Date.now();
  logger.info(`Scheduler: job "${job.name}" started`);
  try {
    await job.handler();
    job.lastStatus = "success";
    job.lastError = null;
    logger.info(`Scheduler: job "${job.name}" completed in ${Date.now() - startedAt}ms`);
  } catch (err) {
    job.lastStatus = "failed";
    // Only the error message is recorded/logged — never the raw error
    // object or any arguments a handler closed over, which a future job
    // could plausibly attach request/payment context to. Drawing this
    // boundary here means a future job accidentally throwing something
    // that wraps a token/secret can't leak it into the scheduler's own
    // logs just by erroring out.
    job.lastError = err.message;
    logger.error(`Scheduler: job "${job.name}" failed after ${Date.now() - startedAt}ms: ${err.message}`);
  } finally {
    job.running = false;
    job.lastRunAt = startedAt;
    job.lastDurationMs = Date.now() - startedAt;
  }
}

function tick() {
  const now = Date.now();
  for (const job of jobs.values()) {
    if (!job.enabled) continue;
    const due = job.lastRunAt === null || now - job.lastRunAt >= job.intervalMs;
    if (!due) continue;
    // Fire-and-forget from the tick loop's perspective — a slow job must
    // never block the loop from checking every other job. runJob's own
    // `running` guard is what stops the NEXT tick from double-starting
    // this same job while it's still in flight; runJob itself never
    // rejects (every path is try/caught), but the loop doesn't rely on
    // that promise from a caller's perspective either.
    runJob(job).catch(() => {});
  }
}

// Idempotent — a second start() while already running is a no-op rather
// than a second competing interval.
function start(intervalMs) {
  if (tickHandle) return;
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
    throw new Error("scheduler.start: intervalMs must be a positive integer");
  }
  tickIntervalMs = intervalMs;
  tickHandle = setInterval(tick, intervalMs);
  // Never hold the process open on its own — a scheduler tick alone
  // should not stop `node src/server.js` from exiting if everything else
  // (the HTTP server) has already stopped listening.
  if (typeof tickHandle.unref === "function") tickHandle.unref();
  logger.info(`Scheduler started (tick interval ${intervalMs}ms, ${jobs.size} job(s) registered)`);
}

function stop() {
  if (!tickHandle) return;
  clearInterval(tickHandle);
  tickHandle = null;
  tickIntervalMs = null;
  logger.info("Scheduler stopped");
}

function isRunning() {
  return tickHandle !== null;
}

// Runs one registered job immediately, outside the normal tick cadence —
// still subject to the same `running` overlap guard. Exists for tests
// and future manual/ops triggers; never called by the tick loop itself.
function runNow(name) {
  const job = jobs.get(name);
  if (!job) throw new Error(`Scheduler: no such job "${name}"`);
  return runJob(job);
}

module.exports = {
  registerJob,
  unregisterJob,
  listJobs,
  start,
  stop,
  isRunning,
  runNow,
  getTickIntervalMs: () => tickIntervalMs,
};
