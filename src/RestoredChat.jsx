import { useMemo, useRef, useState } from "react";
import {
  File as FileIcon,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Search,
  Send,
  Square,
  X,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import VoiceNote from "./VoiceNote";
import {
  MAX_MS,
  formatDuration,
  useVoiceRecorder,
  voiceSupported,
} from "./useVoiceRecorder";
import "./restored-chat.css";

const GIPHY_API_KEY = import.meta.env.VITE_GIPHY_API_KEY;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function safeFileName(name) {
  return String(name || "attachment").replace(/[^\w.-]/g, "_");
}

function uniquePart() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function MessageContent({ message, mine = false }) {
  if (message?.deleted_at) return <p>Message deleted</p>;

  if (message?.type === "audio") {
    return (
      <VoiceNote
        src={message.content}
        durationMs={message.duration_ms}
        messageId={message.id}
        mine={mine}
      />
    );
  }

  if (message?.type === "image") {
    return <img className="chat-shared-image" src={message.content} alt="Shared" loading="lazy" />;
  }

  if (message?.type === "file") {
    return (
      <a
        className="chat-file-link"
        href={message.content}
        target="_blank"
        rel="noreferrer"
        download={message.file_name || undefined}
      >
        <span className="chat-file-icon"><FileIcon size={18} /></span>
        <span className="chat-file-copy">
          <strong>{message.file_name || "Attachment"}</strong>
          <small>Tap to open</small>
        </span>
      </a>
    );
  }

  return <p>{message?.content}</p>;
}

export function ChatComposer({ userId, friend = null, space = null, value, onChange, onSubmit }) {
  const fileInputRef = useRef(null);
  const voice = useVoiceRecorder();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [gifOpen, setGifOpen] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [gifs, setGifs] = useState([]);
  const [gifBusy, setGifBusy] = useState(false);

  const chatId = useMemo(
    () => (friend && userId ? [userId, friend.id].sort().join("_") : null),
    [friend, userId]
  );

  const targetName = friend?.username || space?.name || "chat";

  async function insertMedia(content, type, fileName = null, durationMs = null) {
    if (!userId) throw new Error("You're not signed in.");

    if (friend) {
      const { error: insertError } = await supabase.from("messages").insert({
        chat_id: chatId,
        sender_id: userId,
        receiver_id: friend.id,
        content,
        type,
        is_read: false,
        file_name: fileName,
        duration_ms: durationMs,
      });
      if (insertError) throw insertError;
      return;
    }

    if (space) {
      const { error: insertError } = await supabase.from("group_messages").insert({
        group_id: space.id,
        user_id: userId,
        sender_id: userId,
        content,
        type,
        file_name: fileName,
        duration_ms: durationMs,
      });
      if (insertError) throw insertError;
      return;
    }

    throw new Error("No conversation selected.");
  }

  async function uploadBlob(blob, fileName, type, durationMs = null) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("Attachments need an internet connection.");
    }

    const folder = friend ? chatId : `group_${space.id}`;
    const path = `${folder}/${uniquePart()}-${safeFileName(fileName)}`;
    const { error: uploadError } = await supabase.storage
      .from("chat-files")
      .upload(path, blob, {
        contentType: blob.type || undefined,
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage.from("chat-files").getPublicUrl(path);
    if (!publicData?.publicUrl) throw new Error("Couldn't create an attachment URL.");

    await insertMedia(
      publicData.publicUrl,
      type,
      type === "file" ? fileName : null,
      durationMs
    );
  }

  async function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError("That file is over 25 MB.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await uploadBlob(file, file.name, file.type.startsWith("image/") ? "image" : "file");
    } catch (err) {
      console.error("[wavo] attachment", err);
      setError(err?.message || "Couldn't send that attachment.");
    } finally {
      setBusy(false);
    }
  }

  async function loadGifs(term = gifQuery) {
    setError("");
    if (!GIPHY_API_KEY) {
      setError("GIF search isn't configured on this build.");
      return;
    }

    setGifBusy(true);
    try {
      const q = term.trim();
      const endpoint = q ? "search" : "trending";
      const params = new URLSearchParams({
        api_key: GIPHY_API_KEY,
        limit: "24",
        rating: "pg-13",
      });
      if (q) params.set("q", q);
      const response = await fetch(`https://api.giphy.com/v1/gifs/${endpoint}?${params}`);
      if (!response.ok) throw new Error("GIF search failed.");
      const body = await response.json();
      setGifs(body.data || []);
    } catch (err) {
      console.error("[wavo] gif search", err);
      setError("Couldn't load GIFs.");
    } finally {
      setGifBusy(false);
    }
  }

  async function openGifPicker() {
    setGifOpen(true);
    if (!gifs.length) await loadGifs("");
  }

  async function sendGif(gif) {
    const url = gif?.images?.fixed_height?.url || gif?.images?.original?.url;
    if (!url) return;
    setBusy(true);
    setError("");
    try {
      await insertMedia(url, "image");
      setGifOpen(false);
      setGifQuery("");
    } catch (err) {
      console.error("[wavo] gif send", err);
      setError("Couldn't send that GIF.");
    } finally {
      setBusy(false);
    }
  }

  async function startVoice() {
    setError("");
    if (!voiceSupported()) {
      setError("Voice recording isn't available on this device.");
      return;
    }
    await voice.start();
  }

  async function sendVoice() {
    if (!voice.clip) return;
    setBusy(true);
    setError("");
    try {
      await uploadBlob(
        voice.clip.blob,
        `voice.${voice.clip.ext}`,
        "audio",
        voice.clip.ms
      );
      voice.reset();
    } catch (err) {
      console.error("[wavo] voice note", err);
      setError(err?.message || "Couldn't send that voice note.");
    } finally {
      setBusy(false);
    }
  }

  if (voice.recording) {
    return (
      <div className="restored-composer-wrap">
        <div className="voice-record-bar" role="group" aria-label="Recording voice note">
          <button type="button" className="composer-tool danger" onClick={voice.cancel} aria-label="Cancel recording"><X size={19} /></button>
          <span className="voice-record-dot" />
          <strong>{formatDuration(Math.min(voice.elapsed, MAX_MS))}</strong>
          <span className="voice-record-label">Recording</span>
          <button type="button" className="composer-send" onClick={voice.stop} aria-label="Stop recording"><Square size={15} /></button>
        </div>
        {(voice.error || error) && <div className="composer-error">{voice.error || error}</div>}
      </div>
    );
  }

  if (voice.clip) {
    return (
      <div className="restored-composer-wrap">
        <div className="voice-preview-bar">
          <button type="button" className="composer-tool danger" onClick={voice.cancel} aria-label="Discard voice note"><X size={19} /></button>
          <VoiceNote src={voice.clip.url} durationMs={voice.clip.ms} messageId="draft-voice" mine />
          <button type="button" className="composer-send" onClick={sendVoice} disabled={busy} aria-label="Send voice note"><Send size={18} /></button>
        </div>
        {(voice.error || error) && <div className="composer-error">{voice.error || error}</div>}
      </div>
    );
  }

  return (
    <div className="restored-composer-wrap">
      {gifOpen && (
        <section className="gif-picker" aria-label="GIF picker">
          <div className="gif-picker-head">
            <form onSubmit={(e) => { e.preventDefault(); loadGifs(); }}>
              <Search size={17} />
              <input value={gifQuery} onChange={(e) => setGifQuery(e.target.value)} placeholder="Search GIFs" autoFocus />
            </form>
            <button type="button" onClick={() => setGifOpen(false)} aria-label="Close GIFs"><X size={19} /></button>
          </div>
          <div className="gif-grid">
            {gifBusy && <div className="gif-status">Loading GIFs…</div>}
            {!gifBusy && gifs.map((gif) => {
              const preview = gif?.images?.fixed_width_small?.url || gif?.images?.fixed_height_small?.url || gif?.images?.original?.url;
              return <button type="button" key={gif.id} onClick={() => sendGif(gif)} disabled={busy}><img src={preview} alt={gif.title || "GIF"} loading="lazy" /></button>;
            })}
            {!gifBusy && !gifs.length && <div className="gif-status">No GIFs found.</div>}
          </div>
          <small className="gif-credit">Powered by GIPHY</small>
        </section>
      )}

      <form className="composer dm-composer restored-composer" onSubmit={onSubmit}>
        <input ref={fileInputRef} className="attachment-input" type="file" onChange={chooseFile} accept="image/*,video/*,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip" />
        <button type="button" className="composer-tool" onClick={() => fileInputRef.current?.click()} disabled={busy} aria-label="Attach a photo or file"><Paperclip size={19} /></button>
        <button type="button" className="composer-tool gif-tool" onClick={openGifPicker} disabled={busy} aria-label="Send a GIF"><ImageIcon size={18} /><span>GIF</span></button>
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={`Message ${targetName}`} />
        {value?.trim() ? (
          <button className="composer-send" type="submit" disabled={busy} aria-label="Send message"><Send size={18} /></button>
        ) : (
          <button type="button" className="composer-send mic-send" onClick={startVoice} disabled={busy} aria-label="Record voice note"><Mic size={19} /></button>
        )}
      </form>
      {(voice.error || error) && <div className="composer-error">{voice.error || error}</div>}
    </div>
  );
}
