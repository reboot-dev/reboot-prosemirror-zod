import { Authority } from "@monorepo/api/rbt/thirdparty/prosemirror/v1/authority_rbt";
import { DOC_ID } from "@monorepo/common/constants";
import { Application } from "@reboot-dev/reboot";
import sortedMap from "@reboot-dev/reboot-std/collections/v1/sorted_map.js";
import { AuthorityServicer } from "./servicers/authority";
import { CheckpointServicer } from "./servicers/checkpoint";

const initialize = async (context) => {
  // Ensure the doc has been constructed.
  await Authority.ref(DOC_ID).create(context);
};

export const servicers = [
  AuthorityServicer,
  CheckpointServicer,
  ...sortedMap.servicers(),
];

new Application({ servicers, initialize }).run();
