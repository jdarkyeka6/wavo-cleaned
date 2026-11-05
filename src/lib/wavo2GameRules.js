// Pure, shared game rules. This module is NOT a server authorization boundary.
// A future server RPC must validate identity and update game rows atomically.
export function winnerForBoard(kind, board) {
  if (kind === 'tic_tac_toe') {
    if (!Array.isArray(board) || board.length !== 9) throw new Error('Invalid board');
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (const [a,b,c] of lines) if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  } else if (kind === 'connect4') {
    if (!Array.isArray(board) || board.length !== 42) throw new Error('Invalid board');
    for (let r=0;r<6;r++) for (let c=0;c<7;c++) {
      const token=board[r*7+c];
      if (!token) continue;
      for (const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
        if ([1,2,3].every(n => {
          const rr=r+dr*n,cc=c+dc*n;
          return rr>=0&&rr<6&&cc>=0&&cc<7&&board[rr*7+cc]===token;
        })) return token;
      }
    }
  } else throw new Error('Unsupported game');
  return board.every(Boolean) ? 'draw' : null;
}

export function calculateGameMove(game, userId, move) {
  if (!game || game.status !== 'active') throw new Error('Game is not active');
  if (![game.creator_id,game.opponent_id].includes(userId)) throw new Error('Not a participant');
  if (!game.creator_id || !game.opponent_id || game.creator_id === game.opponent_id) throw new Error('Invalid players');
  const kind=game.kind;
  const len=kind==='tic_tac_toe'?9:kind==='connect4'?42:0;
  if (!len) throw new Error('Unsupported game');
  const board=game.state?.board;
  if (!Array.isArray(board)||board.length!==len||board.some(v=>v!==null&&v!=='a'&&v!=='b')) throw new Error('Invalid board');
  if (game.state.turn!==userId || game.state.winner) throw new Error('Not your turn');
  if (winnerForBoard(kind,board)) throw new Error('Game already ended');
  if (typeof move !== 'number'||!Number.isInteger(move)) throw new Error('Invalid move');
  const next=board.slice(),token=userId===game.creator_id?'a':'b';
  if(kind==='tic_tac_toe') {
    if(move<0||move>8||next[move]) throw new Error('Invalid square');
    next[move]=token;
  } else {
    if(move<0||move>6) throw new Error('Invalid column');
    let index=-1;
    for(let row=5;row>=0;row--) if(!next[row*7+move]) { index=row*7+move;break; }
    if(index<0) throw new Error('Column full');
    next[index]=token;
  }
  const outcome=winnerForBoard(kind,next);
  const winner=outcome==='draw'?'draw':outcome==='a'?game.creator_id:outcome==='b'?game.opponent_id:null;
  return { state:{...game.state,board:next,turn:winner?null:(userId===game.creator_id?game.opponent_id:game.creator_id),winner}, status:winner?'finished':'active' };
}
