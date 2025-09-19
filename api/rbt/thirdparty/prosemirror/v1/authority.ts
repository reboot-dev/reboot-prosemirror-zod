import { z } from "zod/v4";

export const Commit = z.object({
  // See prosemirror `Step` type which can be converted to/from JSON
  // via `step.toJSON()` and `step.fromJSON()` for storing and passing
  // around.
  steps: z.array(z.json()).meta({ tag: 1 }),

  // A unique ref identifying this commit.
  ref: z.string().meta({ tag: 2 }),

  // Version number this commit has been applied.
  version: z.number().meta({ tag: 3 }),
});

export const Commits = z.array(Commit);

// See prosemirror `Node` type which is used to represent a "doc",
// which can be converted to/from JSON via `node.toJSON()` and
// `node.fromJSON()` for storing and passing around.
export const Doc = z.json();

export const api = {
  Authority: {
    state: {
      commits: Commits.default(() => []).meta({ tag: 1 }),
      version: z.number().default(0).meta({ tag: 2 }),
    },

    methods: {
      create: {
        kind: "transaction",
        request: {},
        response: {
          doc: Doc.meta({ tag: 1 }),
          version: z.number().meta({ tag: 2 }),
        },
      },
      apply: {
        kind: "writer",
        request: {
          commit: Commit.meta({ tag: 1 }),
        },
        response: z.void(),
      },
      changes: {
        kind: "reader",
        request: {
          sinceVersion: z.number().meta({ tag: 1 }),
        },
        response: {
          commits: Commits.meta({ tag: 1 }),
        },
      },
      // Internal `workflow`, not intended to get externally.
      checkpoint: {
        kind: "workflow",
        request: {},
        response: z.void(),
      },
    },
  },
};
