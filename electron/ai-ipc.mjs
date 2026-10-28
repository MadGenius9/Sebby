import {
  ProviderProfiles,
  RuntimeProfileCredentials,
} from "./provider-profiles.mjs";
import { ProfileVault } from "./profile-vault.mjs";
import { ResponsesProvider } from "./provider.mjs";
import {
  AnthropicProvider,
  ANTHROPIC_CAPABILITIES,
} from "./anthropic-provider.mjs";
import { XaiProvider, XAI_CAPABILITIES } from "./xai-provider.mjs";
import { ChatService } from "./chat.mjs";
import { AgentRuntime } from "./agent-runtime.mjs";
const capabilities = {
  openai: {
    chat: true,
    tools: true,
    reasoningReplay: true,
    voice: false,
    modelDiscovery: false,
  },
  anthropic: ANTHROPIC_CAPABILITIES,
  xai: XAI_CAPABILITIES,
};
const names = { openai: "OpenAI", anthropic: "Anthropic", xai: "xAI" };
const exact = (input, keys) => {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !keys.includes(k))
  )
    throw Error("Invalid settings request.");
};
export async function installAI({
  directory,
  safeStorage,
  register,
  workspace,
  store,
  features,
  development,
  confirm,
  onEvent = () => {},
  isExternalBusy = () => false,
  env = process.env,
  adapters = {
    openai: ResponsesProvider,
    anthropic: AnthropicProvider,
    xai: XaiProvider,
  },
}) {
  const profiles = new ProviderProfiles(directory);
  await profiles.load();
  const vault = new ProfileVault(directory, { safeStorage });
  let chat,
    agents,
    testRun = null,
    settingsBusy = false,
    settingsPromise = null,
    closed = false;
  const internallyBusy = () =>
    !!(closed || chat?.isActive || agents?.isActive || testRun || settingsBusy);
  const busy = () => internallyBusy() || isExternalBusy();
  const assertIdle = () => {
    if (busy())
      throw Error(
        "Finish or cancel active AI work before changing provider settings.",
      );
  };
  const mutateRegister = (name, fn) =>
    register(name, (input) => {
      assertIdle();
      settingsBusy = true;
      settingsPromise = Promise.resolve()
        .then(() => {
          if (closed) throw Error("AI services are closing.");
          return fn(input);
        })
        .finally(() => {
          settingsBusy = false;
          settingsPromise = null;
        });
      return settingsPromise;
    });
  const selected = () => {
    const profile = profiles.selected();
    if (!profile)
      throw Error("Create and select a provider profile in Settings.");
    return profile;
  };
  const providerFor = (id) => {
    const profile = profiles.get(id);
    return new adapters[profile.provider]({
      credentials: new RuntimeProfileCredentials(id, { profiles, vault, env }),
    });
  };
  const router = {
    status: async () => {
      const profile = profiles.selected();
      if (!profile)
        return {
          configured: false,
          provider: "none",
          model: "",
          connection: "not-verified",
        };
      return {
        ...(await providerFor(profile.id).status()),
        profileId: profile.id,
        model: profile.model,
        capabilities: capabilities[profile.provider],
      };
    },
    send: (options) => providerFor(selected().id).send(options),
  };
  const contextConsent = async (request) =>
    confirm(
      "Approve this paid AI request?",
      `${names[selected().provider]} · ${selected().name}\nModel: ${request.model}\nPrompt: ${request.promptCharacters} characters\nMemory: ${request.memoryIncluded ? request.memoryCharacters + " characters" : "not included"}\nHistory: ${request.historyCount} messages (${request.olderMessagesExcluded} older messages omitted)\nFiles: ${JSON.stringify(request.files)}\nSkills: ${JSON.stringify(request.skills)}\nOutgoing payload: ${request.totalPayloadBytes} bytes\nRough text estimate: ${request.estimatedTextTokens} tokens (not a price)\nMaximum output: ${request.maxOutputTokens} tokens\n\n${request.notice}\nYour chat subscription does not cover API usage.`,
    );
  chat = new ChatService({
    provider: router,
    conversations: features.conversations,
    workspace,
    store,
    skills: features.skills,
    approve: contextConsent,
    onEvent: (event) => onEvent("chat", event),
  });
  agents = new AgentRuntime({
    tasks: features.tasks,
    team: features.team,
    workspace,
    provider: router,
    store,
    skills: features.skills,
    development,
    approve: (request) =>
      confirm(
        "Approve specialist work and API usage?",
        `${names[selected().provider]} · ${selected().name}\n${JSON.stringify(request, null, 2)}\n\nTool and file permissions do not extend beyond this request. Each file change still requires full diff review and native confirmation. Your API account may be charged.`,
      ),
  });
  register("provider-status", () => router.status());
  register("list-provider-profiles", async () => {
    const result = profiles.list();
    const statuses = {};
    for (const profile of result.profiles)
      statuses[profile.id] = await new RuntimeProfileCredentials(profile.id, {
        profiles,
        vault,
        env,
      }).status();
    return { ...result, statuses, capabilities };
  });
  mutateRegister("create-provider-profile", async (input) => {
    const result = await profiles.create(input);
    onEvent("profiles", {});
    return result;
  });
  mutateRegister("update-provider-profile", async (input) => {
    exact(input, ["id", "patch"]);
    const result = await profiles.update(input.id, input.patch);
    onEvent("profiles", {});
    return result;
  });
  mutateRegister("select-provider-profile", async (id) => {
    const result = await profiles.select(id);
    onEvent("profiles", {});
    return result;
  });
  mutateRegister("save-provider-key", async (input) => {
    exact(input, ["profileId", "key"]);
    const profile = profiles.get(input.profileId);
    let key = input.key;
    input.key = "";
    try {
      if (typeof key !== "string" || key.length < 20 || key.length > 1024)
        throw Error("Enter a valid API key in the masked field.");
      if (!vault.supported())
        throw Error(
          "OS-protected credential storage is unavailable. No plaintext fallback is allowed.",
        );
      if (
        !(await confirm(
          "Store or replace this API key?",
          `Provider: ${names[profile.provider]}\nProfile: ${profile.name}\n\nThe key will be encrypted using this operating system and kept outside project files and backups. It will not be shown again. No API request is made by saving it.`,
        ))
      )
        return { saved: false };
      if (closed) throw Error("AI services are closing.");
      const result = await vault.save(profile.id, key, {
        confirmed: true,
        provider: profile.provider,
      });
      onEvent("profiles", {});
      return result;
    } finally {
      key = "";
    }
  });
  mutateRegister("remove-provider-key", async (id) => {
    const profile = profiles.get(id);
    if (
      !(await confirm(
        "Remove the stored API key?",
        `${profile.name}\nThe encrypted key will be deleted. An explicitly enabled environment key may still be available. This does not revoke the key at the provider.`,
      ))
    )
      return { removed: false };
    if (closed) throw Error("AI services are closing.");
    const result = await vault.remove(id, { confirmed: true });
    onEvent("profiles", {});
    return result;
  });
  mutateRegister("remove-provider-profile", async (id) => {
    const profile = profiles.get(id);
    if (
      !(await confirm(
        "Remove this provider profile and its stored key?",
        `${profile.name}\nThis removes local metadata and any encrypted key for this profile. It does not revoke provider credentials or delete chat history.`,
      ))
    )
      return { removed: false };
    if (closed) throw Error("AI services are closing.");
    await vault.remove(id, { confirmed: true });
    const result = await profiles.remove(id);
    onEvent("profiles", {});
    return result;
  });
  register("test-provider-profile", (id) => {
    assertIdle();
    const controller = new AbortController();
    const run = { controller, promise: null };
    testRun = run;
    run.promise = (async () => {
      try {
        const profile = profiles.get(id);
        if (!profile.model)
          throw Error("Enter the intended model ID before testing.");
        const provider = providerFor(id);
        if (!(await provider.status()).configured)
          throw Error("No credential is available for this profile.");
        controller.signal.throwIfAborted();
        if (
          !(await confirm(
            "Make a small paid API connection test?",
            `${names[profile.provider]} · ${profile.name}\nModel: ${profile.model}\n\nSend only: “Reply with OK.”\nMaximum output: 16 tokens. This may incur API charges and does not use your workspace, memory, history, or tools. No automatic retry.`,
          ))
        )
          return { status: "denied" };
        controller.signal.throwIfAborted();
        const result = await provider.send({
          model: profile.model,
          input: "Reply with OK.",
          maxOutputTokens: 16,
          signal: controller.signal,
        });
        return {
          status: result.status,
          responseId: result.responseId,
          usage: result.usage,
          error: result.error || null,
          text: result.text?.slice(0, 1000) || "",
        };
      } finally {
        if (testRun === run) testRun = null;
      }
    })();
    return run.promise;
  });
  register("cancel-provider-test", () => {
    testRun?.controller.abort();
    return { cancelled: !!testRun };
  });
  register("start-chat", (input) => {
    if (features.conversationRemovalPending)
      throw Error(
        "Finish the pending conversation removal before starting chat.",
      );
    if (busy()) throw Error("Finish active AI work first.");
    const profile = selected();
    return chat.start({
      ...input,
      model: profile.model,
      maxOutputTokens: profile.options.maxOutputTokens,
    });
  });
  register("chat-status", (runId) => chat.status(runId));
  register("cancel-chat", (runId) => chat.cancel(runId));
  register("start-agent", (input) => {
    if (busy()) throw Error("Finish active AI work first.");
    exact(input, ["taskId", "memberId", "contextOptions", "limits"]);
    const profile = selected();
    return agents.start({
      ...input,
      model: profile.model,
      limits: {
        ...input.limits,
        maxOutputTokens: Math.min(profile.options.maxOutputTokens, 3000),
      },
    });
  });
  register("agent-status", () => ({ active: agents.isActive }));
  register("cancel-agent", (taskId) => agents.cancel(taskId));
  register("review-agent", (taskId) =>
    agents.review(taskId, {
      approveReview: (request) =>
        confirm(
          "Accept this specialist result and coordinator review?",
          `${JSON.stringify(request, null, 2)}\n\nOnly accept after reviewing the complete evidence in Sebby. A model review is not proof that code was run or correct.`,
        ),
    }),
  );
  return {
    profiles,
    vault,
    chat,
    agents,
    provider: router,
    isBusy: busy,
    // Main-process-only handle; never register or serialize this object over IPC.
    voiceContext: () => {
      if (internallyBusy())
        throw Error("Finish active AI work before voice capture.");
      const profile = selected();
      return {
        profileId: profile.id,
        provider: profile.provider,
        credentials: new RuntimeProfileCredentials(profile.id, {
          profiles,
          vault,
          env,
        }),
      };
    },
    shutdown: async () => {
      closed = true;
      const pending = testRun;
      pending?.controller.abort();
      await Promise.allSettled([
        pending?.promise,
        settingsPromise,
        chat.shutdown(),
        agents.shutdown(),
      ]);
    },
  };
}
