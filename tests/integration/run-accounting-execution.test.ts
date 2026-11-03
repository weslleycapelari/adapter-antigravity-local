import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperclip-guardrails-test-'));
process.env.PAPERCLIP_ANTIGRAVITY_QUOTA_FILE = path.join(testDir, 'quota.json');
const { execute, sessionCodec } = await import('../../src/server/index.js');
const fake = fileURLToPath(new URL('../fixtures/fake-agy.mjs', import.meta.url));
await fs.chmod(fake, 0o755);
const logs = [], checkpoints = [];
const context = (scenario, runtime = null) => ({
  runId: 'guardrail-fixture-run',
  agent: { id: 'guardrail-fixture-agent', companyId: 'guardrail-fixture-company', name: 'Fixture' },
  config: { command: fake, cwd: testDir, model: 'gemini-3.8-flash-medium', timeoutSec: 3, graceSec: 0,
    terminalResultCleanupGraceMs: 0, paperclipRuntimeSkills: [], dangerouslySkipPermissions: false,
    env: { PAPERCLIP_TEST_CAPTURE_PATH: path.join(testDir, 'capture'), GUARDRAIL_TEST_SCENARIO: scenario } },
  runtime, context: { taskId: 'guardrail-fixture-task', wakeReason: 'issue_assigned' },
  onLog: async (stream, text) => logs.push({ stream, text }),
  onUsage: async checkpoint => checkpoints.push(checkpoint),
});

test('two real process invocations persist the baseline and account 110 + 22, not 110 + 132', async () => {
  const first = await execute(context('success'));
  const params = sessionCodec.deserialize(sessionCodec.serialize(first.sessionParams));
  const second = await execute(context('success', { sessionId: first.sessionId, sessionParams: params }));
  assert.equal(second.errorCode, undefined);
  assert.equal(second.usageBasis, 'per_run');
  assert.deepEqual(second.usage, { inputTokens: 20, outputTokens: 2, cachedInputTokens: 0 });
  assert.deepEqual(second.sessionParams.antigravityUsageTotals, { inputTokens: 120, outputTokens: 12, cachedInputTokens: 0 });
  assert.equal(second.resultJson.antigravityAccounting.source, 'session_delta');
  assert.deepEqual(checkpoints.at(-1).usage, second.usage);
});

test('timeouts retain observed usage and advance the persisted baseline', async () => {
  const runtime = { sessionId: 'fixture-conversation', sessionParams: { sessionId: 'fixture-conversation', cwd: testDir,
    antigravityUsageTotals: { inputTokens: 100, outputTokens: 10, cachedInputTokens: 0 } } };
  const result = await execute(context('timeout', runtime));
  assert.equal(result.timedOut, true);
  assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 2, cachedInputTokens: 0 });
  assert.deepEqual(result.sessionParams.antigravityUsageTotals, { inputTokens: 120, outputTokens: 12, cachedInputTokens: 0 });
});

test('a fresh-session retry includes both attempts without replaying the old conversation total', async () => {
  const runtime = { sessionId: 'old-conversation', sessionParams: { sessionId: 'old-conversation', cwd: testDir,
    antigravityUsageTotals: { inputTokens: 100, outputTokens: 10, cachedInputTokens: 0 } } };
  const result = await execute(context('unknown-then-success', runtime));
  assert.equal(result.errorCode, undefined);
  assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 12, cachedInputTokens: 0 });
  assert.equal(result.sessionId, 'fixture-conversation');
  assert.deepEqual(result.sessionParams.antigravityUsageTotals, { inputTokens: 100, outputTokens: 10, cachedInputTokens: 0 });
  assert.deepEqual(checkpoints.at(-1).usage, result.usage);
});

test('the isolated ledger records only new tokens', async () => {
  await new Promise(resolve => setTimeout(resolve, 650));
  const ledger = JSON.parse(await fs.readFile(process.env.PAPERCLIP_ANTIGRAVITY_QUOTA_FILE, 'utf8'));
  const events = ledger.accounts.default.events;
  assert.equal(events.length, 5);
  assert.deepEqual(events.map(e => e.totalTokens), [110, 22, 22, 22, 110]);
});
