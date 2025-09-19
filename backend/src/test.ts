// TO RUN THIS TEST:
// yarn run tsx src/test.ts

import { Authority } from "@monorepo/api/rbt/thirdparty/prosemirror/v1/authority_rbt";
import { Checkpoint } from "@monorepo/api/rbt/thirdparty/prosemirror/v1/checkpoint_rbt";
import { Application, Reboot } from "@reboot-dev/reboot";
import { sleep } from "@reboot-dev/reboot-api";
import sortedMap from "@reboot-dev/reboot-std/collections/v1/sorted_map.js";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AuthorityServicer } from "./servicers/authority";
import { CheckpointServicer } from "./servicers/checkpoint";

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

    // Replace the initial doc with the letter 'A'. 
    await authority.apply(context, {
      version: 0,
      changes: [{
        step: {
          from: 1,
          slice: {
            content: [{
              type: "text",
              text: "A",
            }],
          },
          stepType: "replace",
          to: 12,
        },
        client: "unimportant",
      }],
    });

    // Apply the following `step` another 99 times to induce a
    // checkpoint to be taken.
    const step = {
      to: 2,
      slice: {
        content: [{
          type: "text",
          text: "A",
        }],
      },
      stepType: "replace",
      from: 1,
    };

    for (let version = 1; version < 100; version++) {
      await authority.apply(context, {
        version,
        changes: [{ step, client: "unimportant" }],
      });
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
    await authority.apply(context, {
      version: 100,
      changes: [{ step, client: "unimportant" }],
    });

    for (let version = 1; version < 100; version++) {
      const { changes } = await authority.changes(context, {
        sinceVersion: version,
      });
      assert(changes.length === 100 - version + 1);
      for (const change of changes) {
        assert.deepEqual(change.step, step)
      }
    }
  });
});
