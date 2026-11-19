import { capitalizeTerm } from "@t3tools/client-runtime/source-control-clients";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PullRequestComment,
  PullRequestCommit,
  PullRequestDetail,
  PullRequestRef,
} from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";
import { useState } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { latestPullRequestReviewOutcomes, readableFailure } from "./pullRequestDetail.logic";

/** Fork: one-click approval in the header, so a branch-protected merge needs no trip to the host. */
export function ForkPullRequestApproveButton({
  environmentId,
  reference,
  detail,
  term,
  disabled,
  onApproved,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  detail: PullRequestDetail & {
    readonly comments: ReadonlyArray<PullRequestComment>;
    readonly commits: ReadonlyArray<PullRequestCommit>;
  };
  term: string;
  disabled: boolean;
  onApproved: () => void;
}) {
  const [pending, setPending] = useState(false);
  // Hides the button until the refreshed activity carries the new review.
  const [approvedHead, setApprovedHead] = useState<string | null>(null);
  const submitReview = useAtomCommand(pullRequestEnvironment.submitReview, {
    reportFailure: false,
  });

  const headKey = `${detail.url}@${detail.headSha ?? ""}`;
  const viewer = detail.viewer?.toLowerCase();
  const viewerApproved =
    viewer !== undefined &&
    latestPullRequestReviewOutcomes(detail.comments, detail.commits).some(
      (entry) =>
        entry.actor?.login.toLowerCase() === viewer && entry.outcome === "approved" && !entry.stale,
    );
  const canApprove =
    detail.state === "open" &&
    !detail.isDraft &&
    detail.capabilities.review.verdicts.includes("approve") &&
    detail.viewerPermissions.verdicts.includes("approve");
  if (!canApprove || viewerApproved || approvedHead === headKey) return null;

  const approve = async () => {
    if (pending) return;
    setPending(true);
    const result = await submitReview({
      environmentId,
      input: { ...reference, verdict: "approve", body: "", comments: [] },
    });
    setPending(false);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: `Could not approve this ${term}`,
        description: readableFailure(
          squashAtomCommandFailure(result),
          "The host refused the approval. Check that you have access to review this repository.",
        ),
      });
      return;
    }
    setApprovedHead(headKey);
    toastManager.add({ type: "success", title: `${capitalizeTerm(term)} approved` });
    onApproved();
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex shrink-0">
            <Button
              size="xs"
              variant="outline"
              disabled={disabled || pending}
              onClick={() => void approve()}
              aria-label={pending ? "Approving..." : "Approve"}
            >
              <CheckIcon aria-hidden className="size-3.5" />
              <span className="@max-[30rem]/pr-header:hidden">
                {pending ? "Approving..." : "Approve"}
              </span>
            </Button>
          </span>
        }
      />
      <TooltipPopup side="top">Approve this {term}</TooltipPopup>
    </Tooltip>
  );
}
