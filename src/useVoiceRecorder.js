import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useVoiceRecorder
 *
 * Wraps MediaRecorder for the composer. Three states: idle, recording, and
 * "recorded but not sent yet" — the last one matters, because a voice note you
 * can't hear back before sending is a voice note you send twice.
 *
 * The microphone track is stopped the moment recording ends rather than when
 * the component unmounts. On a phone the browser shows a recording indicator
 * for as long as the track is live, and leaving it on after the user has
 * finished looks like the app is still listening.
 */

// Two minutes. Long enough for anything worth saying in a group chat, short
// enough that a forgotten recording can't upload 40 MB over someone's data.
export const MAX_MS = 120000;

// Safari — including every browser on iOS and the WKWebView the native build
// runs in — cannot produce webm. It does mp4/aac. Ask for what this browser
// actually supports rather than assuming Chrome.
function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/aac",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export function voiceSupported() {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState(null); // { blob, url, ms, ext }
  const [error, setError] = useState(null);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const startedAtRef = useRef(0);
  const tickRef = useRef(null);
  // Set when the user cancels, so the stop handler knows to bin the audio
  // instead of handing it back. onstop fires either way.
  const discardRef = useRef(false);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const clearTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!voiceSupported()) {
      setError("This browser can't record audio.");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = rec;
      chunksRef.current = [];
      discardRef.current = false;

      rec.ondataavailable = (e) => {
        if (e.data?.size) chunksRef.current.push(e.data);
      };

      rec.onstop = () => {
        clearTick();
        releaseStream();
        setRecording(false);

        const ms = Date.now() - startedAtRef.current;
        if (discardRef.current) {
          chunksRef.current = [];
          return;
        }
        const type = rec.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        // Under about a third of a second this is a mis-tap, not a message.
        if (blob.size === 0 || ms < 350) return;
        setClip({
          blob,
          url: URL.createObjectURL(blob),
          ms,
          ext: type.includes("mp4") || type.includes("aac") ? "m4a" : "webm",
        });
      };

      startedAtRef.current = Date.now();
      rec.start();
      setRecording(true);
      setElapsed(0);

      tickRef.current = setInterval(() => {
        const ms = Date.now() - startedAtRef.current;
        setElapsed(ms);
        // Stop ourselves at the cap rather than trusting the user to.
        if (ms >= MAX_MS && recorderRef.current?.state === "recording") {
          recorderRef.current.stop();
        }
      }, 100);

      return true;
    } catch (err) {
      releaseStream();
      // Distinguishing these matters: "denied" is a thing the user fixes in
      // settings, everything else is a thing they retry.
      setError(
        err?.name === "NotAllowedError"
          ? "Wavo needs microphone permission to record."
          : "Couldn't start recording."
      );
      return false;
    }
  }, [clearTick, releaseStream]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const cancel = useCallback(() => {
    discardRef.current = true;
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    } else {
      clearTick();
      releaseStream();
      setRecording(false);
    }
    setClip((c) => {
      if (c) URL.revokeObjectURL(c.url);
      return null;
    });
    setElapsed(0);
  }, [clearTick, releaseStream]);

  // Called after a successful send.
  const reset = useCallback(() => {
    setClip((c) => {
      if (c) URL.revokeObjectURL(c.url);
      return null;
    });
    setElapsed(0);
  }, []);

  useEffect(() => {
    return () => {
      clearTick();
      releaseStream();
    };
  }, [clearTick, releaseStream]);

  return { recording, elapsed, clip, error, start, stop, cancel, reset };
}
