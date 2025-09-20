// TO RUN THIS TEST:
// yarn run tsx src/test.ts

import { Authority } from "@monorepo/api/rbt/thirdparty/prosemirror/v1/authority_rbt.js";
import { Checkpoint } from "@monorepo/api/rbt/thirdparty/prosemirror/v1/checkpoint_rbt.js";
import { Application, Reboot } from "@reboot-dev/reboot";
import { sleep } from "@reboot-dev/reboot-api";
import sortedMap from "@reboot-dev/reboot-std/collections/v1/sorted_map.js";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AuthorityServicer } from "./servicers/authority.js";
import { CheckpointServicer } from "./servicers/checkpoint.js";

test("Reboot Prosemirror", async (t) => {
  let rbt: Reboot;

  t.before(async () => {
    rbt = new Reboot();
    await rbt.start();
  });

  t.after(async () => {
    await rbt.stop();
  });

  await t.test("Get changes from before checkpoint", async (t) => {
    await rbt.up(
      new Application({
        servicers: [
          AuthorityServicer,
          CheckpointServicer,
          ...sortedMap.servicers(),
        ],
      })
    );

    const context = rbt.createExternalContext("test");

    const authority = Authority.ref("test");

    await authority.create(context);

    // Replace the initial doc with '0'. 
    await authority.apply(context, {
      commit: {
        ref: "7k6c84wb3opa",
        steps: [{
          to: 12,
          slice: {
            content: [{
              type: "text",
              text: "0",
            }],
          },
          stepType: "replace",
          from: 1,
        }],
        version: 1,
      },
    });

    // Apply 99 more commits each one replacing the  times to induce a
    // checkpoint to be taken.
    const commit = (version: number) => {
      return {
        ref: Math.random().toString(36).substring(2),
        steps: [{
          to: 2,
          slice: {
            content: [{
              type: "text",
              text: version.toString(),
            }],
          },
          stepType: "replace",
          from: 1,
        }],
        version: version + 1,
      };
    };
    
    for (let version = 1; version < 100; version++) {
      await authority.apply(context, { commit: commit(version) });
    }

    // Wait for the checkpoint.
    const checkpoint = Checkpoint.ref("test");

    while (true) {
      const { doc } = await checkpoint.latest(context);
      if (doc.content[0].content[0].text !== "Replace me!") {
        break;
      }
      console.log("Waiting for checkpoint ...");
      await sleep(1);
    }

    // Add one more `step` so that when we get `changes` we'll be
    // combining the steps from the `SortedMap` and the `Authority`.
    await authority.apply(context, { commit: commit(100) });

    for (let version = 1; version < 100; version++) {
      const { commits } = await authority.changes(context, {
        sinceVersion: version,
      });
      assert(commits.length === 100 - version + 1);
      assert(commits[0].steps[0].slice.content[0].text === version.toString());
      assert(commits.at(-1).steps[0].slice.content[0].text === "100");
    }
  });
});
