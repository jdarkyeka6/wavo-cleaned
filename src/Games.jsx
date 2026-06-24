import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { X, RotateCcw } from "lucide-react";

// ===================================================================
// Wavo Games — a self-contained panel that plugs into a DM.
//  Two-player (live, shared state in `games` table):
//    • Tic-tac-toe
//    • Connect Four
//    • Rock-paper-scissors
//  Single-player (no database):
//    • 2048
//    • Snake
//
// Props:
//   chatId      - the DM's chat id (same one messages use)
//   currentUser - { id }
//   opponent    - the friend you're chatting with { id, username }
//   onClose     - () => void
// ===================================================================

// ---------- tic-tac-toe helpers ----------
const TIC_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
function ticWinner(board) {
  for (const [a, b, c] of TIC_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  if (board.every((c) => c)) return "draw";
  return null;
}

// ---------- connect four helpers (6 rows x 7 cols) ----------
const C4_ROWS = 6;
const C4_COLS = 7;
function c4Winner(board) {
  const at = (r, c) => (r >= 0 && r < C4_ROWS && c >= 0 && c < C4_COLS ? board[r * C4_COLS + c] : null);
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < C4_ROWS; r++) {
    for (let c = 0; c < C4_COLS; c++) {
      const v = at(r, c);
      if (!v) continue;
      for (const [dr, dc] of dirs) {
        if (at(r + dr, c + dc) === v && at(r + 2 * dr, c + 2 * dc) === v && at(r + 3 * dr, c + 3 * dc) === v) {
          return v;
        }
      }
    }
  }
  if (board.every((c) => c)) return "draw";
  return null;
}
function c4Drop(board, col, symbol) {
  for (let r = C4_ROWS - 1; r >= 0; r--) {
    const idx = r * C4_COLS + col;
    if (!board[idx]) {
      const nb = [...board];
      nb[idx] = symbol;
      return nb;
    }
  }
  return null;
}

// ---------- rock paper scissors ----------
const RPS_BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };
const RPS_EMOJI = { rock: "✊", paper: "✋", scissors: "✌️" };

export default function Games({ chatId, currentUser, opponent, onClose }) {
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [solo, setSolo] = useState(null); // null | "2048" | "snake"
  const myId = currentUser?.id;

  useEffect(() => {
    if (!chatId) return;
    let active = true;
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("games")
        .select("*")
        .eq("chat_id", chatId)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (active) {
        setGame(data?.[0] || null);
        setLoading(false);
      }
    }
    load();
    const channel = supabase
      .channel(`games:${chatId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "games", filter: `chat_id=eq.${chatId}` },
        (payload) => {
          if (payload.new) setGame(payload.new);
        }
      )
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [chatId]);

  async function startGame(type) {
    let state;
    if (type === "tictactoe") {
      state = { board: Array(9).fill(null), xPlayer: myId, oPlayer: opponent.id, turn: myId, winner: null };
    } else if (type === "connect4") {
      state = { board: Array(C4_ROWS * C4_COLS).fill(null), xPlayer: myId, oPlayer: opponent.id, turn: myId, winner: null };
    } else if (type === "rps") {
      state = { picks: {}, scores: { [myId]: 0, [opponent.id]: 0 }, round: 1, lastResult: null };
    }
    const { data, error } = await supabase
      .from("games")
      .insert({ chat_id: chatId, type, state, created_by: myId })
      .select()
      .single();
    if (error) {
      alert("Couldn't start game: " + error.message);
      return;
    }
    setGame(data);
  }

  async function saveState(newState) {
    setGame((g) => (g ? { ...g, state: newState } : g));
    const { error } = await supabase
      .from("games")
      .update({ state: newState, updated_at: new Date().toISOString() })
      .eq("id", game.id);
    if (error) alert(error.message);
  }

  // ----- tic-tac-toe move -----
  function playTic(i) {
    const s = game.state;
    if (s.winner || s.turn !== myId || s.board[i]) return;
    const mySymbol = s.xPlayer === myId ? "X" : "O";
    const board = [...s.board];
    board[i] = mySymbol;
    const winner = ticWinner(board);
    const nextTurn = s.xPlayer === myId ? s.oPlayer : s.xPlayer;
    saveState({ ...s, board, turn: winner ? s.turn : nextTurn, winner });
  }

  // ----- connect four move -----
  function playC4(col) {
    const s = game.state;
    if (s.winner || s.turn !== myId) return;
    const mySymbol = s.xPlayer === myId ? "X" : "O";
    const board = c4Drop(s.board, col, mySymbol);
    if (!board) return;
    const winner = c4Winner(board);
    const nextTurn = s.xPlayer === myId ? s.oPlayer : s.xPlayer;
    saveState({ ...s, board, turn: winner ? s.turn : nextTurn, winner });
  }

  // ----- rps -----
  function playRps(choice) {
    const s = game.state;
    if (s.picks[myId]) return;
    const picks = { ...s.picks, [myId]: choice };
    let scores = { ...s.scores };
    let lastResult = s.lastResult;
    const mine = picks[myId];
    const theirs = picks[opponent.id];
    if (mine && theirs) {
      let winner = "tie";
      if (mine !== theirs) {
        winner = RPS_BEATS[mine] === theirs ? myId : opponent.id;
        scores[winner] = (scores[winner] || 0) + 1;
      }
      lastResult = { [myId]: mine, [opponent.id]: theirs, winner };
    }
    saveState({ ...s, picks, scores, lastResult });
  }
  function nextRpsRound() {
    const s = game.state;
    saveState({ ...s, picks: {}, round: (s.round || 1) + 1, lastResult: null });
  }

  // -------------------------- RENDER --------------------------
  let body;
  if (solo === "2048") body = <Game2048 onBack={() => setSolo(null)} />;
  else if (solo === "snake") body = <Snake onBack={() => setSolo(null)} />;
  else if (loading) body = <div style={S.center}>Loading…</div>;
  else if (game && game.type === "tictactoe")
    body = <TicTacToe state={game.state} myId={myId} opponent={opponent} onCell={playTic} onNew={() => startGame("tictactoe")} />;
  else if (game && game.type === "connect4")
    body = <ConnectFour state={game.state} myId={myId} opponent={opponent} onCol={playC4} onNew={() => startGame("connect4")} />;
  else if (game && game.type === "rps")
    body = <Rps state={game.state} myId={myId} opponent={opponent} onPick={playRps} onNext={nextRpsRound} />;
  else
    body = (
      <div style={S.menu}>
        <p style={S.menuHint}>Challenge {opponent?.username} to a live game, or play solo.</p>
        <button style={S.bigBtn} onClick={() => startGame("tictactoe")}>
          ⭕ Tic-Tac-Toe <span style={S.tag}>vs {opponent?.username}</span>
        </button>
        <button style={S.bigBtn} onClick={() => startGame("connect4")}>
          🔴 Connect Four <span style={S.tag}>vs {opponent?.username}</span>
        </button>
        <button style={S.bigBtn} onClick={() => startGame("rps")}>
          ✊ Rock Paper Scissors <span style={S.tag}>vs {opponent?.username}</span>
        </button>
        <button style={S.bigBtn} onClick={() => setSolo("2048")}>
          🔢 2048 <span style={S.tag}>solo</span>
        </button>
        <button style={S.bigBtn} onClick={() => setSolo("snake")}>
          🐍 Snake <span style={S.tag}>solo</span>
        </button>
      </div>
    );

  return (
    <div style={S.panel}>
      <div style={S.head}>
        <strong style={{ fontSize: 14 }}>
          {solo === "2048" ? "2048" : solo === "snake" ? "Snake" : "Games"}
        </strong>
        <button style={S.iconBtn} onClick={onClose} aria-label="Close games">
          <X size={16} />
        </button>
      </div>
      {body}
      {!solo && game && (
        <button style={S.backLink} onClick={() => setGame(null)}>
          ← Back to game menu
        </button>
      )}
    </div>
  );
}

// ------------------------ TIC TAC TOE ------------------------
function TicTacToe({ state, myId, opponent, onCell, onNew }) {
  const mySymbol = state.xPlayer === myId ? "X" : "O";
  const myTurn = state.turn === myId;
  let status;
  if (state.winner === "draw") status = "It's a draw!";
  else if (state.winner) {
    const iWon = (state.winner === "X" && state.xPlayer === myId) || (state.winner === "O" && state.oPlayer === myId);
    status = iWon ? "🎉 You win!" : `${opponent.username} wins`;
  } else status = myTurn ? "Your turn" : `${opponent.username}'s turn`;

  return (
    <div style={S.gameBody}>
      <div style={S.status}>You are <strong>{mySymbol}</strong> · {status}</div>
      <div style={S.ticGrid}>
        {state.board.map((cell, i) => (
          <button
            key={i}
            style={{ ...S.ticCell, cursor: !cell && myTurn && !state.winner ? "pointer" : "default", color: cell === "X" ? "#6C7CFF" : "#FB7185" }}
            onClick={() => onCell(i)}
          >
            {cell}
          </button>
        ))}
      </div>
      {state.winner && <button style={S.newBtn} onClick={onNew}><RotateCcw size={14} /> Play again</button>}
    </div>
  );
}

// ------------------------ CONNECT FOUR ------------------------
function ConnectFour({ state, myId, opponent, onCol, onNew }) {
  const mySymbol = state.xPlayer === myId ? "X" : "O";
  const myColor = mySymbol === "X" ? "#6C7CFF" : "#FB7185";
  const myTurn = state.turn === myId;
  let status;
  if (state.winner === "draw") status = "It's a draw!";
  else if (state.winner) {
    const iWon = (state.winner === "X" && state.xPlayer === myId) || (state.winner === "O" && state.oPlayer === myId);
    status = iWon ? "🎉 You win!" : `${opponent.username} wins`;
  } else status = myTurn ? "Your turn — tap a column" : `${opponent.username}'s turn`;

  const discColor = (v) => (v === "X" ? "#6C7CFF" : v === "O" ? "#FB7185" : "transparent");

  return (
    <div style={S.gameBody}>
      <div style={S.status}>
        You are <span style={{ color: myColor }}>●</span> · {status}
      </div>
      <div style={S.c4Board}>
        {Array.from({ length: C4_COLS }).map((_, col) => (
          <button
            key={col}
            style={{ ...S.c4Col, cursor: myTurn && !state.winner ? "pointer" : "default" }}
            onClick={() => onCol(col)}
            disabled={!myTurn || !!state.winner}
          >
            {Array.from({ length: C4_ROWS }).map((__, row) => {
              const v = state.board[row * C4_COLS + col];
              return <span key={row} style={{ ...S.c4Cell, background: discColor(v) }} />;
            })}
          </button>
        ))}
      </div>
      {state.winner && <button style={S.newBtn} onClick={onNew}><RotateCcw size={14} /> Play again</button>}
    </div>
  );
}

// --------------------- ROCK PAPER SCISSORS ---------------------
function Rps({ state, myId, opponent, onPick, onNext }) {
  const myPick = state.picks[myId];
  const theirPick = state.picks[opponent.id];
  const bothIn = myPick && theirPick;
  const r = state.lastResult;
  let banner = "Pick your move";
  if (myPick && !theirPick) banner = `Waiting for ${opponent.username}…`;
  if (bothIn && r) {
    if (r.winner === "tie") banner = "Tie!";
    else if (r.winner === myId) banner = "🎉 You win the round!";
    else banner = `${opponent.username} wins the round`;
  }
  return (
    <div style={S.gameBody}>
      <div style={S.score}>
        <span>You {state.scores[myId] || 0}</span>
        <span style={{ opacity: 0.5 }}>—</span>
        <span>{state.scores[opponent.id] || 0} {opponent.username}</span>
      </div>
      <div style={S.status}>{banner}</div>
      {bothIn && r ? (
        <div style={S.rpsReveal}>
          <div style={S.rpsBig}>{RPS_EMOJI[r[myId]]}</div>
          <span style={{ opacity: 0.5 }}>vs</span>
          <div style={S.rpsBig}>{RPS_EMOJI[r[opponent.id]]}</div>
        </div>
      ) : (
        <div style={S.rpsRow}>
          {["rock", "paper", "scissors"].map((c) => (
            <button
              key={c}
              style={{ ...S.rpsBtn, outline: myPick === c ? "2px solid #6C7CFF" : "none", opacity: myPick && myPick !== c ? 0.4 : 1 }}
              disabled={!!myPick}
              onClick={() => onPick(c)}
            >
              <span style={{ fontSize: 30 }}>{RPS_EMOJI[c]}</span>
              <span style={{ fontSize: 11, textTransform: "capitalize" }}>{c}</span>
            </button>
          ))}
        </div>
      )}
      {bothIn && <button style={S.newBtn} onClick={onNext}><RotateCcw size={14} /> Next round</button>}
    </div>
  );
}

// ----------------------------- 2048 -----------------------------
function emptyBoard() {
  const b = Array.from({ length: 4 }, () => Array(4).fill(0));
  addTile(b);
  addTile(b);
  return b;
}
function addTile(b) {
  const empties = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (b[r][c] === 0) empties.push([r, c]);
  if (!empties.length) return;
  const [r, c] = empties[Math.floor(Math.random() * empties.length)];
  b[r][c] = Math.random() < 0.9 ? 2 : 4;
}
function slide(row) {
  let arr = row.filter((v) => v);
  let gained = 0;
  for (let i = 0; i < arr.length - 1; i++) {
    if (arr[i] === arr[i + 1]) {
      arr[i] *= 2;
      gained += arr[i];
      arr.splice(i + 1, 1);
    }
  }
  while (arr.length < 4) arr.push(0);
  return { row: arr, gained };
}
function rotate(b) {
  return b[0].map((_, c) => b.map((row) => row[c]).reverse());
}
function move2048(board, dir) {
  let b = board.map((r) => [...r]);
  let rotations = { left: 0, up: 3, right: 2, down: 1 }[dir];
  for (let i = 0; i < rotations; i++) b = rotate(b);
  let gained = 0, moved = false;
  b = b.map((row) => {
    const before = row.join(",");
    const { row: nr, gained: g } = slide(row);
    gained += g;
    if (nr.join(",") !== before) moved = true;
    return nr;
  });
  for (let i = 0; i < (4 - rotations) % 4; i++) b = rotate(b);
  return { board: b, gained, moved };
}
const TILE_COLORS = {
  0: "#1e2030", 2: "#3a3f5c", 4: "#4b4f7a", 8: "#6C7CFF", 16: "#7d8bff",
  32: "#FB7185", 64: "#f43f5e", 128: "#F59E0B", 256: "#fbbf24",
  512: "#2DD4BF", 1024: "#4ADE80", 2048: "#C084FC",
};
function Game2048({ onBack }) {
  const [board, setBoard] = useState(emptyBoard);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  const boardRef = useRef(board);
  boardRef.current = board;

  function doMove(dir) {
    if (over) return;
    const { board: nb, gained, moved } = move2048(boardRef.current, dir);
    if (!moved) return;
    addTile(nb);
    setBoard(nb);
    setScore((s) => s + gained);
    const canMove = ["left", "right", "up", "down"].some((d) => move2048(nb, d).moved);
    if (!canMove) setOver(true);
  }

  useEffect(() => {
    const onKey = (e) => {
      const map = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
      if (map[e.key]) {
        e.preventDefault();
        doMove(map[e.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [over]);

  const touch = useRef(null);
  function onTouchStart(e) {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function onTouchEnd(e) {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x;
    const dy = e.changedTouches[0].clientY - touch.current.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) doMove(dx > 0 ? "right" : "left");
    else doMove(dy > 0 ? "down" : "up");
    touch.current = null;
  }
  function restart() {
    setBoard(emptyBoard());
    setScore(0);
    setOver(false);
  }
  return (
    <div style={S.gameBody}>
      <div style={S.score}>
        <span>Score {score}</span>
        <button style={S.smallBtn} onClick={restart}>New</button>
      </div>
      <div style={S.grid2048} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {board.flat().map((v, i) => (
          <div key={i} style={{ ...S.tile, background: TILE_COLORS[v] || "#C084FC", color: v <= 4 ? "#cbd5e1" : "#fff", fontSize: v >= 1024 ? 16 : 20 }}>
            {v || ""}
          </div>
        ))}
      </div>
      {over && <div style={S.status}>Game over! Final score {score}</div>}
      <p style={S.menuHint}>Arrow keys or swipe to play.</p>
      <button style={S.backLink} onClick={onBack}>← Back to game menu</button>
    </div>
  );
}

// ----------------------------- SNAKE -----------------------------
const SNAKE_SIZE = 12; // 12x12 grid
function Snake({ onBack }) {
  const [snake, setSnake] = useState([[6, 6]]);
  const [food, setFood] = useState([3, 3]);
  const [dir, setDir] = useState([0, 1]);
  const [over, setOver] = useState(false);
  const [score, setScore] = useState(0);
  const [running, setRunning] = useState(false);
  const dirRef = useRef(dir);
  dirRef.current = dir;
  const snakeRef = useRef(snake);
  snakeRef.current = snake;
  const foodRef = useRef(food);
  foodRef.current = food;

  function randFood(body) {
    let cell;
    do {
      cell = [Math.floor(Math.random() * SNAKE_SIZE), Math.floor(Math.random() * SNAKE_SIZE)];
    } while (body.some(([r, c]) => r === cell[0] && c === cell[1]));
    return cell;
  }
  function reset() {
    setSnake([[6, 6]]);
    setFood([3, 3]);
    setDir([0, 1]);
    setOver(false);
    setScore(0);
    setRunning(true);
  }

  useEffect(() => {
    if (!running || over) return;
    const tick = setInterval(() => {
      const body = snakeRef.current;
      const [dr, dc] = dirRef.current;
      const head = body[0];
      const next = [head[0] + dr, head[1] + dc];
      if (
        next[0] < 0 || next[0] >= SNAKE_SIZE || next[1] < 0 || next[1] >= SNAKE_SIZE ||
        body.some(([r, c]) => r === next[0] && c === next[1])
      ) {
        setOver(true);
        setRunning(false);
        return;
      }
      const ate = next[0] === foodRef.current[0] && next[1] === foodRef.current[1];
      const newBody = [next, ...body];
      if (!ate) newBody.pop();
      else {
        setScore((s) => s + 1);
        setFood(randFood(newBody));
      }
      setSnake(newBody);
    }, 180);
    return () => clearInterval(tick);
  }, [running, over]);

  useEffect(() => {
    const onKey = (e) => {
      const map = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      const nd = map[e.key];
      if (!nd) return;
      e.preventDefault();
      const [cr, cc] = dirRef.current;
      if (nd[0] === -cr && nd[1] === -cc) return;
      setDir(nd);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function turn(nd) {
    const [cr, cc] = dirRef.current;
    if (nd[0] === -cr && nd[1] === -cc) return;
    setDir(nd);
  }

  const cells = [];
  for (let r = 0; r < SNAKE_SIZE; r++) {
    for (let c = 0; c < SNAKE_SIZE; c++) {
      const isHead = snake[0][0] === r && snake[0][1] === c;
      const isBody = snake.some(([sr, sc], i) => i > 0 && sr === r && sc === c);
      const isFood = food[0] === r && food[1] === c;
      let bg = "rgba(255,255,255,0.04)";
      if (isHead) bg = "#4ADE80";
      else if (isBody) bg = "#2DD4BF";
      else if (isFood) bg = "#FB7185";
      cells.push(<div key={`${r}-${c}`} style={{ ...S.snakeCell, background: bg }} />);
    }
  }

  return (
    <div style={S.gameBody}>
      <div style={S.score}>
        <span>Score {score}</span>
        {!running && <button style={S.smallBtn} onClick={reset}>{over ? "Retry" : "Start"}</button>}
      </div>
      <div style={S.snakeGrid}>{cells}</div>
      {over && <div style={S.status}>Game over! Score {score}</div>}
      <div style={S.dpad}>
        <button style={S.dBtn} onClick={() => turn([-1, 0])}>▲</button>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={S.dBtn} onClick={() => turn([0, -1])}>◀</button>
          <button style={S.dBtn} onClick={() => turn([1, 0])}>▼</button>
          <button style={S.dBtn} onClick={() => turn([0, 1])}>▶</button>
        </div>
      </div>
      <p style={S.menuHint}>Arrow keys or the buttons to steer.</p>
      <button style={S.backLink} onClick={onBack}>← Back to game menu</button>
    </div>
  );
}

// ----------------------------- STYLES -----------------------------
const S = {
  panel: {
    borderTop: "1px solid var(--line, #2a2d3e)", padding: "12px 14px",
    maxHeight: "62vh", overflowY: "auto", background: "var(--bg-elev, rgba(0,0,0,0.15))",
  },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  iconBtn: { background: "none", border: "none", color: "var(--text-dim, #8b8fa3)", cursor: "pointer", padding: 4 },
  center: { textAlign: "center", padding: 20, color: "var(--text-dim, #8b8fa3)" },
  menu: { display: "flex", flexDirection: "column", gap: 8 },
  menuHint: { fontSize: 12, color: "var(--text-dim, #8b8fa3)", margin: "4px 0 8px", textAlign: "center" },
  bigBtn: {
    display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-start",
    padding: "12px 14px", borderRadius: 12, border: "1px solid var(--line, #2a2d3e)",
    background: "transparent", color: "var(--text, #e7e9f0)", fontSize: 15, fontWeight: 600, cursor: "pointer",
  },
  tag: { marginLeft: "auto", fontSize: 11, color: "var(--text-dim, #8b8fa3)", fontWeight: 400 },
  gameBody: { display: "flex", flexDirection: "column", alignItems: "center", gap: 12 },
  status: { fontSize: 14, color: "var(--text, #e7e9f0)", textAlign: "center" },
  score: { display: "flex", gap: 12, alignItems: "center", fontSize: 14, fontWeight: 600, width: "100%", justifyContent: "center" },
  ticGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, width: 210 },
  ticCell: {
    aspectRatio: "1", fontSize: 34, fontWeight: 700, borderRadius: 10,
    border: "1px solid var(--line, #2a2d3e)", background: "rgba(255,255,255,0.03)",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  c4Board: { display: "flex", gap: 4, background: "#1e2030", padding: 6, borderRadius: 10 },
  c4Col: { display: "flex", flexDirection: "column", gap: 4, background: "none", border: "none", padding: 0 },
  c4Cell: { width: 28, height: 28, borderRadius: "50%", border: "2px solid #15172a", boxSizing: "border-box", display: "block" },
  rpsRow: { display: "flex", gap: 10, justifyContent: "center" },
  rpsBtn: {
    display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 70, padding: "12px 0",
    borderRadius: 12, cursor: "pointer", border: "1px solid var(--line, #2a2d3e)",
    background: "rgba(255,255,255,0.03)", color: "var(--text, #e7e9f0)",
  },
  rpsReveal: { display: "flex", gap: 16, alignItems: "center" },
  rpsBig: { fontSize: 48 },
  newBtn: {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 999,
    border: "none", cursor: "pointer", fontWeight: 600, background: "linear-gradient(90deg,#6C7CFF,#FB7185)", color: "#fff",
  },
  smallBtn: {
    padding: "4px 12px", borderRadius: 8, border: "1px solid var(--line,#2a2d3e)",
    background: "none", color: "var(--text,#e7e9f0)", cursor: "pointer", fontSize: 12,
  },
  grid2048: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, width: 240, touchAction: "none" },
  tile: { aspectRatio: "1", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 },
  snakeGrid: { display: "grid", gridTemplateColumns: `repeat(${SNAKE_SIZE},1fr)`, gap: 2, width: 240, background: "#1e2030", padding: 4, borderRadius: 8 },
  snakeCell: { aspectRatio: "1", borderRadius: 3 },
  dpad: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6 },
  dBtn: {
    width: 44, height: 36, borderRadius: 8, border: "1px solid var(--line,#2a2d3e)",
    background: "rgba(255,255,255,0.04)", color: "var(--text,#e7e9f0)", cursor: "pointer", fontSize: 16,
  },
  backLink: {
    marginTop: 12, background: "none", border: "none", cursor: "pointer",
    color: "var(--text-dim, #8b8fa3)", fontSize: 13, display: "block", width: "100%", textAlign: "center",
  },
};
