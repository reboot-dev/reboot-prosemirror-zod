import { Checkpoint } from "@monorepo/api/rbt/thirdparty/prosemirror/v1/checkpoint_rbt";
import { INITIAL_DOC, SCHEMA } from "@monorepo/common/constants";
import { ReaderContext, WriterContext, allow } from "@reboot-dev/reboot";
import { assert } from "@reboot-dev/reboot-api";
import { Node } from "prosemirror-model";
import { Step } from "prosemirror-transform";

export class CheckpointServicer extends Checkpoint.Servicer {
  authorizer() {
    return allow();
  }

  async latest(
    context: ReaderContext,
    request: Checkpoint.LatestRequest
  ): Promise<Checkpoint.LatestResponse> {
    return {
      doc: this.state.doc,
      version: this.state.version,
    };
  }

  async update(
    context: WriterContext,
    request: Checkpoint.UpdateRequest
  ): Promise<void> {
    let doc = this.state.doc
      ? Node.fromJSON(SCHEMA, this.state.doc)
      : INITIAL_DOC;

    const steps = request.commits
      .flatMap(({ steps }) => steps)
      .map((step) => Step.fromJSON(SCHEMA, step));

    let failed = false;
    for (const step of steps) {
      ({ doc, failed } = step.apply(doc));
      assert(doc && !failed, "Should be able to `apply()` commits");
    }

    this.state.doc = doc.toJSON();
    this.state.version += request.commits.length;
  }
}
