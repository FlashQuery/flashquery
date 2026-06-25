// Boundary-probe utility: send a freeform prompt to the configured model and print
// the reply. Use it to interrogate the model's own category boundaries — e.g. "you
// called this 'resolved'; what would you consider 'deferred'?" — so we can align our
// prompt definitions and fixtures to how the model actually reasons.
//
//   npx tsx src/probe.ts --prompt "..."     (respects --model, --reasoning-effort, etc.)

import { resolveSettings } from './config.ts';
import { makeTransport } from './llm-client.ts';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const settings = resolveSettings(argv);
  const i = argv.indexOf('--prompt');
  const prompt = i !== -1 ? argv[i + 1] : argv.filter((a) => !a.startsWith('--')).join(' ');
  if (!prompt) {
    console.error('Usage: tsx src/probe.ts --prompt "your question"');
    process.exit(1);
  }
  const model = settings.models[0];
  const transport = makeTransport(settings, model);
  console.log(`model=${model}  reasoning_effort=${settings.reasoningEffort ?? '(unset)'}\n`);
  const r = await transport.complete([{ role: 'user', content: prompt }]);
  console.log(r.text);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
