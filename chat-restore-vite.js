function replaceRequired(source, from, to, label) {
  if (!source.includes(from)) {
    throw new Error(`[wavo chat restore] Could not find ${label}. The chat shell changed and needs an explicit update.`);
  }
  return source.replace(from, to);
}

export default function chatRestorePlugin() {
  return {
    name: "wavo-chat-controls-restore",
    enforce: "pre",
    transform(code, id) {
      const cleanId = id.split("?")[0].replaceAll("\\", "/");
      if (!cleanId.endsWith("/src/App.jsx")) return null;

      let next = code;

      next = replaceRequired(
        next,
        'import "./styles.css";',
        'import "./styles.css";\nimport { ChatComposer, MessageContent } from "./RestoredChat";',
        "RestoredChat import anchor"
      );

      next = replaceRequired(
        next,
        '<header className="chat-topbar"><button onClick={() => setSelectedFriend(null)}><ChevronLeft /></button>',
        '<header className="chat-topbar"><button className="chat-back-button" onClick={() => setSelectedFriend(null)} aria-label="Back to Inbox"><ChevronLeft size={20} /><span>Inbox</span></button>',
        "DM back button"
      );

      next = replaceRequired(
        next,
        '{m.type === "image" ? <img src={m.content} alt="Shared" /> : <p>{m.deleted_at ? "Message deleted" : m.content}</p>}',
        '<MessageContent message={m} mine={m.sender_id === userId} />',
        "DM message renderer"
      );

      next = replaceRequired(
        next,
        '{messages.map((m) => <div key={m.id} className={m.sender_id === userId || m.user_id === userId ? "space-message mine" : "space-message"}><span>{m.sender?.username || (m.sender_id === userId || m.user_id === userId ? "You" : "Member")}</span><p>{m.deleted_at ? "Message deleted" : m.content}</p></div>)}',
        '{messages.map((m) => <div key={m.id} className={m.sender_id === userId || m.user_id === userId ? "space-message mine" : "space-message"}><span>{m.sender?.username || (m.sender_id === userId || m.user_id === userId ? "You" : "Member")}</span><MessageContent message={m} mine={m.sender_id === userId || m.user_id === userId} /></div>)}',
        "Space message renderer"
      );

      next = replaceRequired(
        next,
        '<form className="composer dm-composer" onSubmit={sendMessage}><input value={messageText} onChange={(e) => setMessageText(e.target.value)} placeholder={`Message ${selectedFriend.username}`} /><button><Send size={18} /></button></form>',
        '<ChatComposer userId={userId} friend={selectedFriend} value={messageText} onChange={setMessageText} onSubmit={sendMessage} />',
        "DM composer"
      );

      next = replaceRequired(
        next,
        '<form className="composer" onSubmit={sendMessage}><input value={messageText} onChange={(e) => setMessageText(e.target.value)} placeholder={`Message ${selectedSpace.name}`} /><button><Send size={18} /></button></form>',
        '<ChatComposer userId={userId} space={selectedSpace} value={messageText} onChange={setMessageText} onSubmit={sendMessage} />',
        "Space composer"
      );

      return { code: next, map: null };
    },
  };
}
