import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseAntigravityStreamJson, createAntigravityStreamParser } from '../../src/server/parse.js';
import { normalizeRunAccounting } from '../../src/server/run-accounting.js';
import { sessionCodec } from '../../src/server/index.js';

const usage = (inputTokens, outputTokens, cachedInputTokens = 0) => ({ inputTokens, outputTokens, cachedInputTokens });
const raw = u => ({ input_tokens: u.inputTokens, output_tokens: u.outputTokens, cache_read_tokens: u.cachedInputTokens });
const stream = (step, total, { denied = [], status = 'SUCCESS', id = 'conversation-1' } = {}) => [
  { event: 'init', conversation_id: id },
  ...(step ? [{ event: 'step_update', step_update: { conversation_id: id, step_index: 5, state: 'DONE', step_type: 'agent_response', usage: raw(step), text_delta: 'Done.' } }] : []),
  ...(total ? [{ event: 'result', result: { conversation_id: id, status, usage: raw(total), denied_actions: denied } }] : []),
].map(JSON.stringify).join('\n') + '\n';

test('fresh conversation counts total once, including usage missing from step telemetry', () => {
  const a = normalizeRunAccounting(parseAntigravityStreamJson(stream(usage(90, 5), usage(100, 10))));
  assert.deepEqual(a.usage, usage(100, 10));
  assert.deepEqual(a.sessionUsage, usage(100, 10));
});

test('resumed conversation counts the delta, not the complete historical result', () => {
  const a = normalizeRunAccounting(parseAntigravityStreamJson(stream(usage(23807, 426), usage(41006, 1042))), {
    resumeSessionId: 'conversation-1', sessionUsageBaseline: usage(17199, 616),
  });
  assert.deepEqual(a.usage, usage(23807, 426));
  assert.equal(a.source, 'session_delta');
});

test('existing sessions without a baseline use current steps and seed the next baseline', () => {
  const total = usage(41006, 1042);
  const a = normalizeRunAccounting(parseAntigravityStreamJson(stream(usage(23807, 426), total)), { resumeSessionId: 'conversation-1' });
  assert.deepEqual(a.usage, usage(23807, 426));
  assert.deepEqual(a.sessionUsage, total);
  assert.equal(a.source, 'migration_steps');
});

test('a result-only resume is measurable when the baseline is persisted', () => {
  const a = normalizeRunAccounting(parseAntigravityStreamJson(stream(null, usage(120, 12, 400))), {
    resumeSessionId: 'conversation-1', sessionUsageBaseline: usage(100, 10, 300),
  });
  assert.deepEqual(a.usage, usage(20, 2, 100));
});

test('unmeasurable historical result-only resumes are explicitly marked incomplete', () => {
  const a = normalizeRunAccounting(parseAntigravityStreamJson(stream(null, usage(120, 12))), { resumeSessionId: 'conversation-1' });
  assert.equal(a.incomplete, true);
  assert.equal(a.source, 'migration_steps');
  assert.deepEqual(a.sessionUsage, usage(120, 12));
});

test('timeout steps advance the baseline and are not charged again on the next resume', () => {
  const a = normalizeRunAccounting(parseAntigravityStreamJson(stream(usage(20, 2, 50), null)), {
    resumeSessionId: 'conversation-1', sessionUsageBaseline: usage(100, 10, 300),
  });
  assert.deepEqual(a.usage, usage(20, 2, 50));
  assert.deepEqual(a.sessionUsage, usage(120, 12, 350));
  const b = normalizeRunAccounting(parseAntigravityStreamJson(stream(usage(30, 3, 60), usage(150, 15, 410))), {
    resumeSessionId: 'conversation-1', sessionUsageBaseline: a.sessionUsage,
  });
  assert.deepEqual(b.usage, usage(30, 3, 60));
});

test('new conversations and account failovers do not inherit the old baseline', () => {
  const a = normalizeRunAccounting(parseAntigravityStreamJson(stream(usage(20, 2), usage(20, 2), { id: 'new-conversation' })), {
    resumeSessionId: 'conversation-1', sessionUsageBaseline: usage(100, 10),
  });
  assert.deepEqual(a.usage, usage(20, 2));
  assert.equal(a.source, 'session_total');
});

test('stream parser is stable when checkpointing growing stdout snapshots', () => {
  const read = parseAntigravityStreamJson;
  const full = stream(usage(20, 2), usage(20, 2));
  const first = full.split('\n').slice(0, 2).join('\n') + '\n';
  read(first);
  const a = read(full);
  const b = read(full);
  assert.equal(a.summary, 'Done.');
  assert.equal(b.summary, 'Done.');
  assert.deepEqual(a.usage, b.usage);
});

test('duplicate step updates do not duplicate usage', () => {
  const s = stream(usage(20, 2), null);
  const a = normalizeRunAccounting(parseAntigravityStreamJson(s + s.split('\n')[1] + '\n'));
  assert.deepEqual(a.usage, usage(20, 2));
});

test('negative and non-finite usage cannot create negative deltas or poison session state', () => {
  const a = normalizeRunAccounting({ sessionId: 'conversation-1', stepUsage: usage(2, 1), sessionUsage: usage(-1, Infinity), usage: usage(2, 1) });
  assert.deepEqual(a.usage, usage(2, 1));
  assert.deepEqual(a.sessionUsage, usage(2, 1));
});

test('baseline survives both directions of the Paperclip session codec', () => {
  const params = { sessionId: 'conversation-1', cwd: '/tmp/example', antigravityUsageTotals: usage(100, 10, 300) };
  assert.deepEqual(sessionCodec.deserialize(sessionCodec.serialize(params)), params);
  assert.equal(sessionCodec.deserialize({ ...params, antigravityUsageTotals: { inputTokens: -1 } }).antigravityUsageTotals, undefined);
});

test('counter reset is bounded by current totals and includes observed steps', () => {
  const a = normalizeRunAccounting(parseAntigravityStreamJson(stream(usage(20, 2), usage(20, 2))), {
    resumeSessionId: 'conversation-1', sessionUsageBaseline: usage(100, 10),
  });
  assert.deepEqual(a.usage, usage(20, 2));
});

// Preserve the public incremental parser API; checkpoint callers use snapshots.
test('incremental parser preserves prior chunks and their distinct response deltas', () => {
  const read = createAntigravityStreamParser();
  const first = JSON.stringify({event: 'step_update', step_update: {step_index: 1, step_type: 'agent_response', text_delta: 'First.', usage: {input_tokens: 20, output_tokens: 2}}});
  const second = JSON.stringify({event: 'step_update', step_update: {step_index: 2, step_type: 'agent_response', text_delta: 'Second.', usage: {input_tokens: 30, output_tokens: 3}}});
  read(first);
  const result = read(second);
  assert.equal(result.summary, 'First.Second.');
  assert.deepEqual(result.stepUsage, usage(50, 5));
});
