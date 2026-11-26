/**
 * JSON Schema for knot YAML validation using AJV.
 */
import Ajv, { type ValidateFunction } from 'ajv';

/** JSON Schema for the KnotSpec v0 format. */
export const knotSchemaV0 = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['version', 'name', 'instructions'],
  additionalProperties: false,
  properties: {
    version: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+$',
      description: 'Semantic version of the knot spec format.',
    },
    name: {
      type: 'string',
      pattern: '^[a-z0-9][a-z0-9_-]*$',
      minLength: 1,
      maxLength: 64,
      description: 'Machine-readable slug identifier.',
    },
    display_name: {
      type: 'string',
      maxLength: 128,
      description: 'Human-readable name.',
    },
    description: {
      type: 'string',
      maxLength: 1024,
      description: 'Short description of what this knot does.',
    },
    instructions: {
      type: 'string',
      minLength: 1,
      description: 'System prompt / instructions for the AI.',
    },
    tools: {
      type: 'array',
      uniqueItems: true,
      items: { enum: ['list_files', 'read_file', 'create_file', 'mcp_call', 'memory'] },
    },
    integrations: {
      type: 'object',
      additionalProperties: {
        type: 'array',
        uniqueItems: true,
        items: { type: 'string', minLength: 1 },
      },
    },
    expected_output: { type: 'string', minLength: 1 },
    model_preferences: {
      type: 'object',
      additionalProperties: false,
      properties: {
        preferred_capability: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'tool_calling',
              'vision',
              'structured_output',
              'long_context',
              'streaming',
              'system_prompt',
              'json_mode',
              'code_execution',
            ],
          },
        },
        privacy: {
          type: 'string',
          enum: ['local_only', 'local_preferred', 'cloud_allowed', 'any'],
        },
        max_output_tokens: { type: 'integer', minimum: 1 },
        max_cost_per_run: {
          type: 'number',
          minimum: 0,
        },
        preferred_provider: {
          type: 'string',
          minLength: 1,
        },
        preferred_model: {
          type: 'string',
          minLength: 1,
        },
      },
    },
    lanes: {
      type: 'object',
      additionalProperties: {
        type: 'array',
        items: { type: 'string' },
      },
      description: 'Named lanes mapping to ordered strand lists.',
    },
    tags: {
      type: 'array',
      items: { type: 'string', maxLength: 32 },
      maxItems: 20,
      description: 'Categorization tags.',
    },
    knowledge_refs: {
      type: 'array',
      items: { type: 'string' },
      description: 'Relative paths to knowledge files.',
    },
    rules: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type', 'scope', 'value'],
        additionalProperties: false,
        properties: {
          type: {
            type: 'string',
            enum: ['allow', 'deny', 'require'],
          },
          scope: {
            type: 'string',
            enum: ['provider', 'model', 'capability', 'action'],
          },
          value: {
            type: 'string',
            minLength: 1,
          },
          reason: {
            type: 'string',
          },
        },
      },
      description: 'Policy rules for routing and execution.',
    },
    created_at: {
      type: 'string',
      description: 'ISO 8601 creation timestamp.',
    },
    updated_at: {
      type: 'string',
      description: 'ISO 8601 last update timestamp.',
    },
  },
} as const;

let _validate: ValidateFunction | null = null;

/** Get the cached AJV validator for knot specs. */
export function getKnotValidator(): ValidateFunction {
  if (!_validate) {
    const ajv = new Ajv({ allErrors: true });
    _validate = ajv.compile(knotSchemaV0);
  }
  return _validate;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validate a parsed knot object against the schema. */
export function validateKnotSpec(data: unknown): ValidationResult {
  const validate = getKnotValidator();
  const valid = validate(data) as boolean;
  const errors: string[] = [];

  if (!valid && validate.errors) {
    for (const err of validate.errors) {
      const path = err.instancePath || '/';
      errors.push(`${path}: ${err.message ?? 'unknown error'}`);
    }
  }

  return { valid, errors };
}
