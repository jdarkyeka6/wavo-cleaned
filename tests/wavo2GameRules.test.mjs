import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateGameMove,winnerForBoard } from '../src/lib/wavo2GameRules.js';

const a='player-a',b='player-b';
const game=(kind,board,turn=a)=>({creator_id:a,opponent_id:b,kind,status:'active',state:{board,turn,winner:null}});
test('tic tac toe starts with legal turn',()=>{
  const input=game('tic_tac_toe',Array(9).fill(null));
  const next=calculateGameMove(input,a,0);
  assert.equal(next.state.board[0],'a');
  assert.equal(next.state.turn,b);
  assert.equal(input.state.board[0],null);
});
test('rejects untrusted moves',()=>{
  const g=game('tic_tac_toe',Array(9).fill(null));
  for(const move of [-1,9,NaN,'1',1.5]) assert.throws(()=>calculateGameMove(g,a,move));
  assert.throws(()=>calculateGameMove(g,b,0));
  assert.throws(()=>calculateGameMove(g,'third',0));
});
test('detects tic tac toe win',()=>{
  const g=game('tic_tac_toe',['a','a',null,'b','b',null,null,null,null]);
  const next=calculateGameMove(g,a,2);
  assert.equal(next.state.winner,a);
  assert.equal(next.status,'finished');
});
test('connect4 places token in lowest vacant row',()=>{
  const next=calculateGameMove(game('connect4',Array(42).fill(null)),a,3);
  assert.equal(next.state.board[38],'a');
});
test('connect4 recognizes vertical winner',()=>{
  const board=Array(42).fill(null);
  for(const row of [5,4,3]) board[row*7+2]='a';
  assert.equal(winnerForBoard('connect4',board),null);
  const next=calculateGameMove(game('connect4',board),a,2);
  assert.equal(next.state.winner,a);
});
test('rejects malformed, finished and already-won boards',()=>{
  assert.throws(()=>calculateGameMove(game('connect4',[null]),a,0));
  const g=game('tic_tac_toe',['a','a','a',null,null,null,null,null,null]);
  assert.throws(()=>calculateGameMove(g,a,4));
  g.status='finished';
  assert.throws(()=>calculateGameMove(g,a,4));
});
