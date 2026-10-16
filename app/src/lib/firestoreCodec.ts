// Helpers shared by the Firestore repositories: conversion of SDK types at the
// boundary. Timestamps never leave the repositories — in the domain, dates
// travel as epoch milliseconds (see bookDocSchema/chapterDocSchema).

import { Timestamp } from 'firebase/firestore';

/**
 * Copies a snapshot's data, converting every top-level Timestamp to
 * milliseconds. The domain schemas are flat: no recursion.
 */
export function timestampsToMillis(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const [key, value] of Object.entries(out)) {
    if (value instanceof Timestamp) {
      out[key] = value.toMillis();
    }
  }
  return out;
}

/** Normalizes SDK errors (which sometimes throws non-Error values) to Error. */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
