# Opt-in local hands-free conversation

This extends the existing local Whisper/Kokoro/Ollama pipeline. It is off on
every app start and requires explicit session authorization, with a visible
microphone indicator and a Disable control. Existing push-to-talk remains.

## Use

1. Start with `Launch-Sebby.cmd`. Select the local Ollama profile and Local
   neural speech, with an available matching voice/reply language.
2. Use headphones/headset. Speaker playback is not supported for this mode:
   echo cancellation cannot guarantee rejection of Sebby's own speaker audio.
3. In Chat, confirm the headphones checkbox, click Enable hands-free listening,
   and review the native local-chat and microphone prompts once for the session.
4. Say **Hello Sebby**, optionally followed by a request. Whisper recognition
   takes several seconds; this is speech-segment recognition, not a specialized
   instant/low-power keyword detector. English input is the supported first slice.
5. Follow-up requests need no wake phrase for 45 seconds after active model/speech
   work. Speaking interrupts active speech/model work after sustained audio
   detection (about 300 ms in the software detector; acoustic/device timing varies).
6. Say **go to sleep** to require the wake phrase again. The microphone remains
   active in wake mode. Say **stop listening**, click Disable or Stop voice
   activity, leave Chat, or close Sebby to release it. No restart or automatic
   next-session opt-in is saved. Sessions expire after 30 minutes / 60 turns.

## Scope and retention

Native permission binds the microphone to this window and the chat grant to
the exact selected local profile/model/workspace/revision. Each spoken turn
uses a fresh dedicated conversation's recent history, at most 512 output tokens.
No cloud fallback, tools, extra memory/files/skills, or desktop commands are
authorized. Normal cloud/tool/action confirmations remain unchanged.

All voice segments, including background speech while waiting for the phrase,
are processed locally. Audio is bounded to 5 MiB / 30 seconds per request, with
shorter renderer segmentation and no disk recording. Silent segments are
discarded without recognition; only one recognition is pending, with no queue.
Accepted turns and replies use existing local chat-history persistence. Existing
typed drafts block enabling and are never silently sent as hands-free context.
Speech detection can be triggered by noise; voice identity is not authentication.

An interrupted CPU synthesis can continue draining. Only an explicit local
HTTP 409 busy response permits a bounded recognition-only retry (up to twenty
500 ms waits); cancellation invalidates it. Chat is never automatically retried.
Other failures disable hands-free visibly, release tracks and revoke grants.
Changing provider, reply language or speech preferences ends the session.

## Acceptance and evidence

Required checks: explicit opt-in before media access, native denial/cancel,
window/profile binding, no cloud/context escalation, wake/background filtering,
automatic follow-up without another getUserMedia call, interruption, stale result
suppression, bounded audio/lease/retries, device-failure/unmount/global-stop cleanup,
and preservation of existing chat/PTT/Studio regressions.

Independent review found and fixed device cleanup exceptions, an idle-segment
follow-up drop, and a native voice-grant revocation race during model preparation.
Separate critic tests reproduced the failures before verifying the fixes.

Automated checks are separate from live Windows/headset evidence. The live
hands-free microphone test is being requested from the user; it must not be
reported as passed from mocked VAD, synthetic audio or prior push-to-talk tests.
Disconnected-network operation and speaker-mode reliability are not certified.

Final local Windows gauntlet: 397 Node tests passed, 22 existing platform skips;
157 component tests passed across 30 files; TypeScript, production build and
formatting passed. Local ignored evidence is `.handsfree-final-gauntlet.log`
and `.gauntlet/latest.json`. This includes explicit busy-engine recovery,
cancel-during-wait and retry-cap tests; no model request is retried.
