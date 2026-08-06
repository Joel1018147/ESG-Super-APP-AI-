'use strict';
// Postgres-backed job queue. Never setTimeout: Railway restarts containers
// whenever it likes and an in-memory timer dies with the container, silently,
// leaving a nightly sync that everyone believes is running.
//
// Claiming uses FOR UPDATE SKIP LOCKED so two container instances never run the
// same job. The partial unique index uq_esg_jobs_singleton stops the same
// recurring job type being queued twice in the first place.

const { query } = require('../db');

const handlers = new Map();
function register(jobType, fn) { handlers.set(jobType, fn); }

async function enqueue(jobType, payload = {}, runAt = new Date()) {
  const { rows } = await query(
    `INSERT INTO esg_scheduled_jobs (job_type, payload, run_at)
     VALUES ($1,$2,$3)
     ON CONFLICT DO NOTHING
     RETURNING id`, [jobType, payload, runAt]);
  return rows[0] ? rows[0].id : null;   // null = already queued or running
}

async function claimOne(workerId) {
  const { rows } = await query(
    `UPDATE esg_scheduled_jobs SET status='running', locked_at=now(), locked_by=$1,
            attempts = attempts + 1
      WHERE id = (
        SELECT id FROM esg_scheduled_jobs
         WHERE status='pending' AND run_at <= now()
         ORDER BY run_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING id, job_type, payload, attempts, max_attempts`, [workerId]);
  return rows[0] || null;
}

async function runOnce(workerId = `w-${process.pid}`) {
  const job = await claimOne(workerId);
  if (!job) return null;
  const handler = handlers.get(job.job_type);
  if (!handler) {
    await query(`UPDATE esg_scheduled_jobs SET status='failed', last_error=$2 WHERE id=$1`,
                [job.id, `No handler registered for '${job.job_type}'`]);
    return job;
  }
  try {
    await handler(job.payload || {});
    await query(`UPDATE esg_scheduled_jobs SET status='done', last_error=NULL WHERE id=$1`, [job.id]);
  } catch (err) {
    const dead = job.attempts >= job.max_attempts;
    await query(
      `UPDATE esg_scheduled_jobs
          SET status = $2, last_error = $3, run_at = now() + interval '5 minutes'
        WHERE id = $1`,
      [job.id, dead ? 'failed' : 'pending', err.message]);
  }
  return job;
}

// Polling interval, not a scheduler. setInterval is acceptable HERE and only
// here: it drives the poll loop, and if the container dies mid-poll the jobs are
// still sitting in Postgres for the next container to claim.
let timer = null;
function startWorker(intervalMs = 30000) {
  if (timer) return;
  timer = setInterval(() => { runOnce().catch((e) => console.error('jobRunner:', e.message)); }, intervalMs);
  if (timer.unref) timer.unref();
}
function stopWorker() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { register, enqueue, claimOne, runOnce, startWorker, stopWorker, handlers };
