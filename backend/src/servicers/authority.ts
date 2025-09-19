import { Commits } from "@monorepo/api/rbt/thirdparty/prosemirror/v1/authority";
import { Authority } from "@monorepo/api/rbt/thirdparty/prosemirror/v1/authority_rbt";
import { Checkpoint } from "@monorepo/api/rbt/thirdparty/prosemirror/v1/checkpoint_rbt";
import { SCHEMA } from "@monorepo/common/constants";
import {
  ReaderContext,
  WriterContext,
  TransactionContext,
  WorkflowContext,
  allow,
  until,
} from "@reboot-dev/reboot";
import { assert, errors_pb } from "@reboot-dev/reboot-api";
import { SortedMap } from "@reboot-dev/reboot-std/collections/v1/sorted_map.js";
import { applyCommitJSON } from "@stepwisehq/prosemirror-collab-commit/apply-commit";
import { Node } from "prosemirror-model";
import { Step } from "prosemirror-transform";
import { z } from "zod/v4";

const encode = (value: any): Uint8Array => {
  return new TextEncoder().encode(JSON.stringify(value));
};

const decode = (bytes: Uint8Array) => {
  return JSON.parse(new TextDecoder().decode(bytes));
};

export class AuthorityServicer extends Authority.Servicer {
  #cache?: { version: number; doc: Node };

  authorizer() {
    return allow();
  }

  private async cache(
    context: ReaderContext | WriterContext | TransactionContext
  ) {
    // If we don't have a cached doc or we recently took a checkpoint
    // and the doc is now out of date, fetch the latest.
    if (!this.#cache || this.#cache.version < this.state.version) {
      const { doc, version } = await this.#checkpoint.latest(context);
      this.#cache = { doc: Node.fromJSON(SCHEMA, doc), version };
    }

    // Hydrate the doc or return an already hydrated doc if there are
    // no outstanding commits in the latest `state` that need to be
    // hydrated.
    let { doc, version } = this.#cache;

    // Invariant is that `version` should never be less than
    // `this.state.version` because we should have always fetched the
    // latest above.
    assert(version >= this.state.version);

    // Check for any commits that we should be applying.
    if (version < this.state.version + this.state.commits.length) {
      const commits = this.state.commits.slice(version - this.state.version);
      assert(commits.length > 0);

      const steps = commits
        .flatMap(({ steps }) => steps)
        .map((step) => Step.fromJSON(SCHEMA, step));

      let failed = false;
      for (const step of steps) {
        assert(step);
        ({ doc, failed } = step.apply(doc));
        assert(doc && !failed, "Should be able to `apply()` commits");
      }

      this.#cache = { doc, version: version + commits.length };
    }

    return this.#cache;
  }

  async create(
    context: TransactionContext,
    request: Authority.CreateRequest
  ): Promise<Authority.CreateResponse> {
    // Call `update()` without any commits to ensure the checkpoint
    // has been created so we can safely call `latest()`.
    await this.#checkpoint.update(context);

    const { doc, version } = await this.cache(context);

    return { doc: doc.toJSON(), version };
  }

  async apply(
    context: WriterContext,
    { commit }: Authority.ApplyRequest
  ): Promise<void> {

    if (this.state.commits.find(({ ref }) => ref === commit.ref)) {
      throw new Authority.ApplyAborted(
        new errors_pb.InvalidArgument(), {
	  message: "Already received this commit ref",
	});
    }

    // Validate that we can apply this commit!
    let { doc, version } = await this.cache(context);

    // If this is the first commit we're applying, also schedule
    // the `checkpoint` workflow.
    if (version == 0) {
      await this.ref().schedule().checkpoint(context);
    }

    const { commitJSON } = applyCommitJSON(
      version,
      SCHEMA,
      doc.toJSON(),
      // Expecting only "new" commits, i.e., document commits since
      // the commit we're trying to apply that have been committed.
      this.state.commits.filter(({ version }) => version > commit.version),
      commit
    );

    // NOTE: we don't update `this.#cache` as that is a side-effect;
    // instead `this.cache()` will correctly return a hydrated doc
    // based on the latest `state` when ever we need it.
    this.state.commits = [...this.state.commits, commitJSON];
  }

  async changes(
    context: ReaderContext,
    { sinceVersion }: Authority.ChangesRequest
  ): Promise<Authority.ChangesResponse> {
    // If the caller asks for a version less than what we have as part
    // of this state, go out to the `SortedMap` and get what they need.
    if (sinceVersion < this.state.version) {
      // TODO: support just sending the current doc if the number of
      // changes they need is greater than some value, e.g., 1000.
      const { entries } = await this.#commits.range(context, {
        startKey: sinceVersion.toString().padStart(20, "0"),
        limit: this.state.version - sinceVersion,
      });

      const commits = entries.map(({ value }) => decode(value));

      return {
        commits: [...commits, ...this.state.commits],
      };
    }

    if (sinceVersion > this.state.version + this.state.commits.length) {
      throw new Authority.ChangesAborted(new errors_pb.InvalidArgument());
    }

    return {
      commits: this.state.commits.slice(sinceVersion - this.state.version),
    };
  }

  async checkpoint(
    context: WorkflowContext,
    request: Authority.CheckpointRequest
  ): Promise<void> {
    // Control loop which checkpoints after accumulating 100 changes.
    for await (const iteration of context.loop("checkpoint")) {
      let { commits, version } = await until(
        `At least 100 changes accumulated`,
        context,
        async () => {
          const { commits, version } = await this.ref().read(context);
          return commits.length >= 100 && { commits, version };
        },
        { schema: z.object({ commits: Commits, version: z.number() }) }
      );

      // 1. Save the changes out to a `SortedMap` so that we can
      // still send just steps to clients that are behind.
      const entries = {};
      for (const commit of commits) {
        entries[version.toString().padStart(20, "0")] = encode(commit);
        version += 1;
      }
      await this.#commits.insert(context, { entries });

      // 2. Apply the steps to the checkpoint. We need to do this
      // first so that if we get rebooted before 2. we'll just fetch
      // the latest checkpoint and apply only the relevant changes (if
      // any) from `state.changes`. Alternatively we could update
      // `state` and update the checkpoint in a transaction.
      await this.#checkpoint.update(context, { commits });

      // 3. Truncate the changes and update the version.
      await this.ref().write(context, async (state) => {
        state.commits = state.commits.slice(commits.length);
        state.version += commits.length;
      });
    }
  }

  get #checkpoint() {
    // Using relative naming here, `Checkpoint` instance has same name
    // as this instance of `Authority`.
    return Checkpoint.ref(this.ref().stateId);
  }

  get #commits() {
    // Using relative naming here, `SortedMap` instance has same name
    // as this instance of `Authority`.
    return SortedMap.ref(this.ref().stateId);
  }
}
