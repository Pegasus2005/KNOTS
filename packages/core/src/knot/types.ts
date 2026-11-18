/**
 * Internal knot types and re-exports from @knots/types.
 */
export type {
  KnotSpec,
  ModelPreferences,
  ModelCapability,
  Lane,
} from '@knots/types';

export type SemVer = string;
export type PrivacyLevel = 'local_only' | 'local_preferred' | 'cloud_allowed' | 'any';

/** Metadata attached to a loaded knot (not part of the spec itself). */
export interface KnotMeta {
  /** Absolute path to the .knot.yaml file. */
  filePath: string;
  /** When the knot was last modified on disk. */
  lastModified: Date;
}

/** A loaded knot: spec + metadata. */
export interface LoadedKnot {
  spec: import('@knots/types').KnotSpec;
  meta: KnotMeta;
}

/** Options for saving a knot. */
export interface SaveKnotOptions {
  /** Whether to allow replacing an existing knot. */
  overwrite?: boolean;
  /** Whether to create a versioned backup before overwriting. */
  backup?: boolean;
}
