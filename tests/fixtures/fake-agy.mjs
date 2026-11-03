#!/usr/bin/env node
// Deterministic local CLI fixture. No model requests, credentials or API calls.
import fs from 'node:fs';
const scenario = process.env.GUARDRAIL_TEST_SCENARIO || 'success';
const args = process.argv.slice(2);
const priorIndex = args.indexOf('--conversation');
const id = priorIndex >= 0 ? args[priorIndex + 1] : 'fixture-conversation';
const send = event => process.stdout.write(JSON.stringify(event) + '\n');
send({ event: 'init', conversation_id: id });
const input = priorIndex >= 0 ? 20 : 100;
const output = priorIndex >= 0 ? 2 : 10;
send({ event: 'step_update', step_update: { conversation_id: id, step_index: priorIndex >= 0 ? 5 : 1, state: 'DONE', step_type: 'agent_response', usage: { input_tokens: input, output_tokens: output, cache_read_tokens: 0 }, text_delta: 'Fixture response.' } });
if (process.env.GUARDRAIL_TEST_CAPTURE) fs.appendFileSync(process.env.GUARDRAIL_TEST_CAPTURE, JSON.stringify(args) + '\n');
if (scenario === 'timeout') await new Promise(resolve => setTimeout(resolve, 20_000));
const unknown = scenario === 'unknown-then-success' && priorIndex >= 0;
send({ event: 'result', result: { conversation_id: id, status: unknown ? 'ERROR' : 'SUCCESS',
  ...(unknown ? { error: 'unknown conversation' } : {}),
  response: 'Fixture response.', usage: { input_tokens: priorIndex >= 0 ? 120 : 100, output_tokens: priorIndex >= 0 ? 12 : 10, cache_read_tokens: 0 } } });
