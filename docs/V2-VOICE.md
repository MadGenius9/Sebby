# Sebby realtime voice

Sebby v2 retains Bot HQ's xAI speech-to-speech implementation, including selectable voices, language/speed, streamed microphone audio, streamed playback, interruption, captions, mute and hangup. This change connects its voice-to-agent relay to exact turn results instead of guessing completion from unrelated chat rows.

## Start a call

Use the full agent service mode described in `.env.example` and `README.md`. Configure a server-side `XAI_API_KEY`, a working Hermes gateway and the service's other required settings. The model defaults to `grok-voice-latest` and is configurable through `XAI_VOICE_MODEL`. Your text agent's model can differ from the voice model. No Ollama setup is needed.

The loopback `npm run workspace` mode is an editor without AI services; it does not provide a connected voice agent. In the configured full service, open the agent chat, select the bot, then use its details panel's Voice chat controls to choose a voice, preview it and start a call. Microphone access requires HTTPS or localhost. A preview, call, transcription and call summary can incur provider charges.

Voice authenticates with a short-lived credential minted on the server. The permanent provider key stays server-side. On a call, microphone audio is sent to xAI. Selected agent memories, instructions and recent chat are included in voice context; call transcripts are saved in the agent's chat when the call ends. Stopping a call stops microphone tracks and playback. Already submitted agent jobs continue in chat; hangup is not cancellation of those jobs.

## Tracked work

Each `send_task` carries a provider tool-call ID. The active call, user and bot are checked before accepting it. Duplicate IDs return the same job; a conflicting request with the same ID is rejected. Calls accept at most 20 jobs, each at most 16,000 characters.

The agent queue resolves with that specific turn's status and text. The voice controller polls the call's owner-only, no-cache job endpoint, then injects a short result note when it is not speaking or listening. Failed/cancelled results remain failures/cancellations. Pending approval/input is announced once per changed reason. A result is delivered once in the current call; unrelated chat messages cannot finish it. Three failed status polls end the call with an error and direct the user to chat. Jobs are tracked in memory for the current call; after server restart the call must be restarted. This is not durable cross-restart voice-session recovery.

Late task acknowledgements, microphone permission and socket events after hangup cannot restart a call. Page exit tears down audio and sends a best-effort end record. Existing voice selection, language, speech detection and gapless PCM playback remain upstream implementations. xAI audio-history truncation, automatic socket reconnection and actual voice/cost/latency measurements remain outstanding.

## Gauntlet

Run `npm run gauntlet`. It stops at the first failed stage: TypeScript checks, workspace tests (including the actual HTTP voice relay and scripted gateway), voice lifecycle tests, production build and built-server HTTP smoke. Evidence is written to `.gauntlet/latest.json` and is not committed. Tests inject fake credentials, audio and provider responses; they do not call paid services.

Automated verification on November 16, 2026 (America/Chicago): 53 workspace/relay tests and 12 voice tests passed, along with TypeScript checks, production build and built-server HTTP smoke. Existing frontend bundle-size warnings remain.

Before release, configure a real deployment and record these live results:

1. Preview the selected voice; start a call and check intelligible bidirectional audio/captions.
2. Interrupt mid-sentence. Playback must stop, and the interrupted response must not resume.
3. Give two different jobs while an ordinary chat turn is queued. Each spoken outcome must match its own job.
4. Exercise an approval, a failed task and a cancelled task; none should be called a successful result.
5. Mute, hang up, close the tab, and grant a pending microphone prompt after hangup. Verify the microphone indicator turns off.
6. Disconnect/reconnect networking. The current implementation ends a dropped call; start a new one and inspect existing work in chat.

No real microphone, speaker, live xAI/Hermes call, cloud desktop or Windows acceptance was performed in this workspace. Mock checks establish lifecycle behavior, not conversational sound quality or provider interoperability.

## Sources

The inherited implementation comes from [Bot HQ](https://github.com/nickvasilescu/bot-hq), under its existing MIT notices. Keep those notices with reused code. API details were checked against [xAI speech-to-speech](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech) and [ephemeral tokens](https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens). No external artwork was added.
