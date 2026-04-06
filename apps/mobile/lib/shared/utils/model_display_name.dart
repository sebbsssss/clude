/// Returns a human-friendly display name for a model ID.
/// e.g. "claude-sonnet-4-20250514" → "Sonnet 4"
String modelDisplayName(String modelId) {
  final id = modelId.toLowerCase();
  if (id.contains('sonnet')) return 'Sonnet 4';
  if (id.contains('opus')) return 'Opus 4';
  if (id.contains('haiku')) return 'Haiku 3.5';
  if (id.contains('gpt-4o')) return 'GPT-4o';
  if (id.contains('gpt-4')) return 'GPT-4';
  if (id.contains('llama')) return 'Llama 3.1';
  return modelId;
}
