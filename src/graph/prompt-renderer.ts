import type { GraphRuntimeConfig } from './config.js';
import { DEFAULT_GRAPH_PROMPTS, type GraphPromptDefinition } from './prompts.js';
import { renderClassifiedGraphTypes } from './vocabulary.js';

export function renderGraphPrompt(options: {
  graphConfig: GraphRuntimeConfig;
  promptId: string;
  variables: Record<string, string>;
}): { prompt: GraphPromptDefinition; content: string } {
  const prompt =
    options.graphConfig.resolvedPrompts?.find((item) => item.id === options.promptId) ??
    DEFAULT_GRAPH_PROMPTS.find((item) => item.id === options.promptId);

  if (!prompt) {
    throw new Error(`Graph prompt '${options.promptId}' is not configured`);
  }

  let content = prompt.template;
  for (const [name, value] of Object.entries(options.variables)) {
    content = content.split(`{{${name}}}`).join(value);
  }

  content = content.replace(/\{\{graph:classified_types\}\}/g, () =>
    renderClassifiedGraphTypes(options.graphConfig.resolvedRelations)
  );

  return { prompt, content };
}
