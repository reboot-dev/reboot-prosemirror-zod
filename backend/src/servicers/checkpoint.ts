import { Checkpoint } from "@monorepo/api/rbt/thirdparty/prosemirror/v1/checkpoint_rbt";
import { INITIAL_DOC, SCHEMA } from "@monorepo/common/constants";
import { ReaderContext, WriterContext, allow } from "@reboot-dev/reboot";
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

    for (const { step } of request.changes) {
      doc = Step.fromJSON(SCHEMA, step).apply(doc).doc;
    }

    this.state.doc = doc.toJSON();
    this.state.version += request.changes.length;
  }
}
