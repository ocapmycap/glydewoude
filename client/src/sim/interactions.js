/**
 * Registry for what a tree does when you land on it.
 *
 * Phase 1 ships exactly one interaction — `landmark`, which announces the
 * tree's name for orientation. Shops, puzzles, cafeterias and customization
 * trees are Phase 2–4 and are not implemented here.
 *
 * The registry exists now anyway, because it is thirty lines and it is the
 * difference between Phase 2 adding a shop as a self-contained module and
 * Phase 2 threading shop logic through the landing code path.
 *
 * To add an interaction, see CLAUDE.md — register a handler keyed by the tree
 * `type` from the shared TREE_TYPES table, and have worldgen tag trees with it.
 */

/**
 * @typedef {object} InteractionContext
 * @property {import('@glidewood/shared/worldgen').Tree} tree
 * @property {object} glider     the current glider state (read-only by convention)
 * @property {(event: object) => void} emit  push a UI-facing event
 */

/**
 * @typedef {object} InteractionHandler
 * @property {(ctx: InteractionContext) => void} [onLand]   fires once, on perching
 * @property {(ctx: InteractionContext) => void} [onLeave]  fires once, on launching away
 */

export function createInteractionRegistry() {
  /** @type {Map<string, InteractionHandler>} */
  const handlers = new Map();

  return {
    /**
     * @param {string} treeType  a value from TREE_TYPES
     * @param {InteractionHandler} handler
     */
    register(treeType, handler) {
      handlers.set(treeType, handler);
      return this;
    },

    has(treeType) {
      return handlers.has(treeType);
    },

    /**
     * Landing on a tree with no registered handler is a no-op, not an error:
     * most trees are scenery, and an unimplemented type should never be able
     * to break the glide loop.
     */
    land(tree, ctx) {
      handlers.get(tree.type)?.onLand?.({ ...ctx, tree });
    },

    leave(tree, ctx) {
      handlers.get(tree.type)?.onLeave?.({ ...ctx, tree });
    },
  };
}

/**
 * The one Phase 1 interaction: a named tree announces itself when you arrive.
 *
 * This is the product doc's orientation landmark (§2.3), not economy content
 * (§2.4) — nothing is collected, spent, or persisted.
 */
export const landmarkInteraction = {
  onLand({ tree, emit }) {
    emit({ type: 'landmark:arrived', tree, name: tree.name ?? 'An unnamed bough' });
  },
  onLeave({ tree, emit }) {
    emit({ type: 'landmark:departed', tree });
  },
};
