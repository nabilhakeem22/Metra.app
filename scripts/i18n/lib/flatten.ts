/**
 * Order-preserving flatten / unflatten for next-intl message catalogs.
 *
 * next-intl catalogs are arbitrarily nested objects whose leaf values are
 * always strings. `flatten` turns them into a single-level `dotPath -> string`
 * map; `unflatten` rebuilds the nesting. Both preserve key order so that a
 * generated catalog diffs cleanly against the source (the whole i18n toolchain
 * relies on this: chunking, review, and apply all assume stable order).
 */

export type FlatMessages = Record<string, string>;

/** A nested next-intl catalog: string leaves, object branches. */
export type NestedMessages = { [key: string]: string | NestedMessages };

/**
 * Flatten a nested catalog into `dotPath -> string`, depth-first in source
 * order. Leaf values must be strings; a non-string, non-object leaf is a
 * malformed catalog and throws.
 */
export function flatten(source: NestedMessages, prefix = ''): FlatMessages {
  const out: FlatMessages = {};
  for (const key of Object.keys(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = source[key];
    if (typeof value === 'string') {
      out[path] = value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value, path));
    } else {
      throw new Error(
        `Malformed catalog at "${path}": expected string or object, got ${
          Array.isArray(value) ? 'array' : typeof value
        }.`,
      );
    }
  }
  return out;
}

/**
 * Rebuild a nested catalog from a flat `dotPath -> string` map. Branch objects
 * are created in first-seen order so the reassembled tree keeps the map's
 * ordering. A path that tries to nest under an existing string leaf (or use a
 * leaf as a branch) is a conflict and throws.
 */
export function unflatten(flat: FlatMessages): NestedMessages {
  const root: NestedMessages = {};
  for (const path of Object.keys(flat)) {
    const segments = path.split('.');
    let node: NestedMessages = root;
    for (let index = 0; index < segments.length - 1; index++) {
      const segment = segments[index];
      const existing = node[segment];
      if (existing === undefined) {
        const branch: NestedMessages = {};
        node[segment] = branch;
        node = branch;
      } else if (typeof existing === 'object') {
        node = existing;
      } else {
        throw new Error(
          `Path conflict at "${path}": "${segment}" is already a string leaf.`,
        );
      }
    }
    const leaf = segments[segments.length - 1];
    if (typeof node[leaf] === 'object') {
      throw new Error(
        `Path conflict at "${path}": "${leaf}" is already a branch.`,
      );
    }
    node[leaf] = flat[path];
  }
  return root;
}
