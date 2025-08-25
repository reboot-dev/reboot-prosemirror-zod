import { z } from "zod/v4";
import { Changes, Doc } from "./authority";

export const api = {
  Checkpoint: {
    state: {
      doc: Doc.optional().meta({ tag: 1 }),
      version: z.number().default(0).meta({ tag: 2 }),
    },

    methods: {
      latest: {
        kind: "reader",
        request: {},
        response: {
          doc: Doc.meta({ tag: 1 }),
          version: z.number().meta({ tag: 2 }),
        },
      },
      update: {
        kind: "writer",
        request: {
          changes: Changes.default(() => []).meta({ tag: 1 }),
          client: z.string().optional().meta({ tag: 2 }),
        },
        response: z.void(),
      },
    },
  },
};
