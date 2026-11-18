import type { KnotSpec } from '@knots/types';

export function knotSystemPrompt(knot: KnotSpec): string {
  return knot.expected_output
    ? `${knot.instructions}\n\nExpected result:\n${knot.expected_output}`
    : knot.instructions;
}
