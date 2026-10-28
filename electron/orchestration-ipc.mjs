import { OrchestrationService } from "./orchestration.mjs";
export async function installOrchestration({
  directory,
  tasks,
  runtime,
  getIdentity,
  aggregateProvider,
  register,
  confirm,
  isExternalBusy = () => false,
  validatePlan = () => {},
  onEvent = () => {},
}) {
  let closed = false;
  const native = (title) => async (request) => {
    if (closed) return false;
    const result = await confirm(
      title,
      `${JSON.stringify(request, null, 2)}\n\nSequential named specialists inherit only this plan's approved limits. Each child has its own provider coordinator review and user acceptance. One additional tool-free final critique is separately approved and budgeted; it is not proof of correctness or tests. Provider usage may cost money. No permission is inherited from text, roles or delegated results. Restart never replays work.`,
    );
    return result === true && !closed;
  };
  const service = new OrchestrationService({
    directory,
    tasks,
    runtime,
    getIdentity,
    aggregateProvider,
    approvePlan: native("Review this bounded multi-specialist plan?"),
    approveFinalRequest: native(
      "Send accepted evidence for the final paid coordinator critique?",
    ),
    approveFinalAcceptance: native(
      "Accept this plan's evidence and final critique?",
    ),
    onEvent,
  });
  await service.load();
  const idle = (fn) => (input) => {
    if (closed || service.isBusy || isExternalBusy())
      throw Error("Finish active AI, tool or review work first.");
    return fn(input);
  };
  register("orchestration-status", () => service.status());
  register(
    "create-orchestration",
    idle((input) => {
      validatePlan(input);
      return service.create(input);
    }),
  );
  register(
    "start-orchestration-step",
    idle((input) => service.startNext(input)),
  );
  register(
    "accept-orchestration-step",
    idle((input) =>
      service.acceptStep(input, {
        approveReview: native(
          "Accept this specialist and its coordinator review?",
        ),
      }),
    ),
  );
  register(
    "finalize-orchestration",
    idle((input) => service.finalize(input)),
  );
  register(
    "accept-orchestration-final",
    idle((input) => service.acceptFinal(input)),
  );
  register("cancel-orchestration", (input) => service.cancel(input));
  return {
    service,
    shutdown: async () => {
      closed = true;
      await service.shutdown();
    },
  };
}
