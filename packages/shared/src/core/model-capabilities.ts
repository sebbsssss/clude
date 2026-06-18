/**
 * Model capability flags for the Anthropic / OpenRouter call boundary.
 *
 * Anthropic deprecated the `temperature` and `top_p` sampling params for Opus 4.7+.
 * Passing EITHER to an Opus ≥4.7 model returns HTTP 400 invalid_request_error
 * ("temperature is deprecated for this model") — even `temperature: 0`. Sonnet 4.x,
 * Haiku 4.x, and Opus ≤4.6 still accept them. Strip the params at the SDK boundary so
 * call sites that hardcode a temperature keep working when the configured model is
 * bumped to Opus 4.7 / 4.8 / 5.x. See the feedback-opus-47-no-temperature note.
 */
export function modelRejectsSamplingParams(model: string | null | undefined): boolean {
  if (!model) return false;
  // Opus 4.7 / 4.8 / 4.9, or any Opus 5+. Tolerates separators, provider prefixes,
  // and date suffixes: "claude-opus-4-7-20260101", "anthropic/claude-opus-4.8".
  return /opus[-_.]?4[-_.]?[789]\b|opus[-_.]?[5-9]\b/i.test(model);
}
