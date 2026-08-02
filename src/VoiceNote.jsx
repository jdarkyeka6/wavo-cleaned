import { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { formatDuration } from "./useVoiceRecorder";

/**
 * A voice note bubble.
 *
 * Deliberately not a real waveform: drawing one means fetching and decoding
 * the whole file before anything renders, for every note in the transcript.
 * The bars here are decorative and derived from the message id, so a given
 * note always looks the same without a byte being downloaded until you press
 * play. They fill as it plays, which is the part people actually read.
 */

const BAR_COUNT = 27;

// Deterministic pseudo-heights from the id — same note, same shape, every
// render and every device.
function barsFor(seed) {
  const s = String(seed || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return Array.from({ length: BAR_COUNT }, () => {
    h = (h * 1103515245 + 12345) >>> 0;
    // 35–100% — never a flat line, never a full-height wall.
    return 35 + ((h >>> 8) % 66);
  });
}

export default function VoiceNote({ src, durationMs, messageId, mine }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0); // ms
  const [bars] = useState(() => barsFor(messageId));

  // Trust the stored duration over the element's. MediaRecorder's webm has no
  // duration in its metadata, so audio.duration is Infinity until the file has
  // played through once — which would make the label flicker from a real
  // number to "Infinity:NaN" the moment you pressed play.
  const [fallbackMs, setFallbackMs] = useState(0);
  const total = durationMs || fallbackMs || 0;

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onTime = () => setPosition(el.currentTime * 1000);
    const onEnd = () => {
      setPlaying(false);
      setPosition(0);
      el.currentTime = 0;
    };
    const onMeta = () => {
      if (Number.isFinite(el.duration)) setFallbackMs(el.duration * 1000);
    };

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    el.addEventListener("loadedmetadata", onMeta);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("loadedmetadata", onMeta);
    };
  }, []);

  // Pause every other note when this one starts. Two people's voices at once
  // is nobody's idea of a chat.
  useEffect(() => {
    if (!playing) return;
    const stopOthers = (e) => {
      if (e.detail !== messageId && audioRef.current) {
        audioRef.current.pause();
        setPlaying(false);
      }
    };
    window.addEventListener("wavo:voice-play", stopOthers);
    return () => window.removeEventListener("wavo:voice-play", stopOthers);
  }, [playing, messageId]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      window.dispatchEvent(
        new CustomEvent("wavo:voice-play", { detail: messageId })
      );
      el.play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    }
  };

  const seek = (index) => {
    const el = audioRef.current;
    if (!el || !total) return;
    const ms = (index / BAR_COUNT) * total;
    el.currentTime = ms / 1000;
    setPosition(ms);
  };

  const progress = total ? Math.min(1, position / total) : 0;
  const filledUpTo = Math.round(progress * BAR_COUNT);
  // Counts down while playing, which is how long you've got left to listen —
  // more useful than how long you've already spent.
  const label = playing || position > 0 ? total - position : total;

  return (
    <div className={`voice-note ${mine ? "mine" : ""}`}>
      <button
        type="button"
        className="voice-note-btn"
        onClick={toggle}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
      >
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </button>

      <div
        className="voice-note-bars"
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(total / 1000)}
        aria-valuenow={Math.round(position / 1000)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") seek(Math.min(BAR_COUNT, filledUpTo + 2));
          if (e.key === "ArrowLeft") seek(Math.max(0, filledUpTo - 2));
        }}
      >
        {bars.map((height, i) => (
          <span
            key={i}
            className={`voice-note-bar ${i < filledUpTo ? "on" : ""}`}
            style={{ height: `${height}%` }}
            onClick={() => seek(i)}
          />
        ))}
      </div>

      <span className="voice-note-time">{formatDuration(label)}</span>

      {/* preload="none" so a transcript full of voice notes costs nothing to
          scroll past. */}
      <audio ref={audioRef} src={src} preload="none" />
    </div>
  );
}
