import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RotateCcw, Undo2, Settings2, Trophy, Info, ChevronRight, User, Cpu, Lightbulb, Brain } from 'lucide-react';

// --- Types & Constants ---

type Stone = 'black' | 'white' | null;
type BoardSize = 9 | 13 | 19;
type AILevel = 'easy' | 'normal' | 'hard' | 'god';
type GameMode = 'pvp' | 'ai';

interface GameState {
  board: Stone[][];
  turn: 'black' | 'white';
  capturedBlack: number;
  capturedWhite: number;
  lastMove: { r: number; c: number } | null;
  history: string[]; 
}

// --- Logic Helpers ---

const createEmptyBoard = (size: number): Stone[][] => 
  Array(size).fill(null).map(() => Array(size).fill(null));

const getBoardSnapshot = (board: Stone[][]) => JSON.stringify(board);

function getGroup(r: number, c: number, board: Stone[][], size: number) {
  const color = board[r][c];
  if (!color) return { group: [], liberties: 0, libertyCoords: [] as {r:number, c:number}[] };

  const group: { r: number; c: number }[] = [];
  const visited = new Set<string>();
  const liberties = new Set<string>();
  const libertyCoords: {r:number, c:number}[] = [];
  const stack = [{ r, c }];

  while (stack.length > 0) {
    const curr = stack.pop()!;
    const key = `${curr.r},${curr.c}`;
    if (visited.has(key)) continue;
    visited.add(key);
    group.push(curr);

    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dr, dc] of dirs) {
      const nr = curr.r + dr;
      const nc = curr.c + dc;
      if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
        if (board[nr][nc] === color) {
          stack.push({ r: nr, c: nc });
        } else if (board[nr][nc] === null) {
          if (!liberties.has(`${nr},${nc}`)) {
            liberties.add(`${nr},${nc}`);
            libertyCoords.push({ r: nr, c: nc });
          }
        }
      }
    }
  }

  return { group, liberties: liberties.size, libertyCoords };
}

/**
 * Validates a move without changing the actual game state
 */
function isValidMove(r: number, c: number, board: Stone[][], turn: Stone, history: string[], size: number) {
  if (board[r][c] !== null) return false;
  
  const tempBoard = board.map(row => [...row]);
  const currentColor = turn!;
  const opponentColor = currentColor === 'black' ? 'white' : 'black';
  tempBoard[r][c] = currentColor;

  let captures = 0;
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (const [dr, dc] of dirs) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
      if (tempBoard[nr][nc] === opponentColor) {
        const { liberties } = getGroup(nr, nc, tempBoard, size);
        if (liberties === 0) captures++;
      }
    }
  }

  if (captures === 0) {
    const { liberties } = getGroup(r, c, tempBoard, size);
    if (liberties === 0) return false; // Suicide
  }

  const snapshot = getBoardSnapshot(tempBoard);
  if (history.includes(snapshot)) return false; // Ko

  return true;
}

// --- AI Engines ---

const AI_ENGINE = {
  getValidMoves: (board: Stone[][], turn: Stone, history: string[], size: number) => {
    const moves: {r:number, c:number}[] = [];
    for(let r=0; r<size; r++) {
      for(let c=0; c<size; c++) {
        if (isValidMove(r, c, board, turn, history, size)) {
          moves.push({r, c});
        }
      }
    }
    return moves;
  },

  easy: (board: Stone[][], turn: Stone, history: string[], size: number) => {
    const valid = AI_ENGINE.getValidMoves(board, turn, history, size);
    if (valid.length === 0) return null;
    return valid[Math.floor(Math.random() * valid.length)];
  },

  normal: (board: Stone[][], turn: Stone, history: string[], size: number) => {
    const valid = AI_ENGINE.getValidMoves(board, turn, history, size);
    if (valid.length === 0) return null;

    const myColor = turn!;
    const opColor = myColor === 'black' ? 'white' : 'black';

    // 1. Capture priority
    for (const move of valid) {
      const temp = board.map(row => [...row]);
      temp[move.r][move.c] = myColor;
      const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      for (const [dr, dc] of dirs) {
        const nr = move.r + dr; const nc = move.c + dc;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size && temp[nr][nc] === opColor) {
          if (getGroup(nr, nc, temp, size).liberties === 0) return move;
        }
      }
    }

    // 2. Defense priority (Save from Atari)
    // Simplified: if adding a stone helps a group with 1 liberty
    for (const move of valid) {
      const temp = board.map(row => [...row]);
      temp[move.r][move.c] = myColor;
      const { liberties } = getGroup(move.r, move.c, temp, size);
      if (liberties > 1) {
          // Check if it's protecting a group
          const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
          for (const [dr, dc] of dirs) {
            const nr = move.r+dr; const nc = move.c+dc;
            if (nr>=0 && nr<size && nc>=0 && nc<size && board[nr][nc] === myColor) {
                if (getGroup(nr, nc, board, size).liberties === 1) return move;
            }
          }
      }
    }

    // 3. Strategic spots (Hoshi)
    const strategic = valid.filter(m => {
      const isCorner = (m.r === 3 || m.r === size-4) && (m.c === 3 || m.c === size-4);
      const isCenter = m.r === Math.floor(size/2) && m.c === Math.floor(size/2);
      return isCorner || isCenter;
    });
    if (strategic.length > 0) return strategic[Math.floor(Math.random() * strategic.length)];

    return valid[Math.floor(Math.random() * valid.length)];
  },

  mcts: async (board: Stone[][], turn: Stone, history: string[], size: number, simulations = 500) => {
    const valid = AI_ENGINE.getValidMoves(board, turn, history, size);
    if (valid.length === 0) return null;
    if (valid.length === 1) return valid[0];

    // Split simulations into chunks to avoid blocking UI too much
    const scores = valid.map(() => 0);
    const simsPerMove = Math.max(1, Math.floor(simulations / valid.length));

    for (let i = 0; i < valid.length; i++) {
        const move = valid[i];
        for (let s = 0; s < simsPerMove; s++) {
            if (AI_ENGINE.simulateRollout(board, turn, move, size)) {
                scores[i]++;
            }
        }
    }

    let bestIdx = 0;
    for (let i = 1; i < scores.length; i++) {
        if (scores[i] > scores[bestIdx]) bestIdx = i;
    }
    return valid[bestIdx];
  },

  simulateRollout: (board: Stone[][], turn: Stone, startMove: {r:number, c:number}, size: number) => {
    let currentBoard = board.map(row => [...row]);
    let currentTurn = turn;
    let move = startMove;
    let steps = 0;
    const maxSteps = (size * size) / 3;

    while (steps < maxSteps) {
      currentBoard[move.r][move.c] = currentTurn;
      currentTurn = currentTurn === 'black' ? 'white' : 'black';
      
      const v = AI_ENGINE.getValidMoves(currentBoard, currentTurn, [], size);
      if (v.length === 0) break;
      
      // Simple heuristic for rollout: capture if possible, else random
      move = v[Math.floor(Math.random() * v.length)];
      steps++;
    }

    let bCount = 0; let wCount = 0;
    for(let r=0; r<size; r++) for(let c=0; c<size; c++) {
      if(currentBoard[r][c] === 'black') bCount++;
      else if(currentBoard[r][c] === 'white') wCount++;
    }
    return turn === 'black' ? bCount >= wCount : wCount >= bCount;
  }
};

// --- Components ---

export default function App() {
  const [boardSize, setBoardSize] = useState<BoardSize>(19);
  const [game, setGame] = useState<GameState>(() => {
    const empty = createEmptyBoard(19);
    return {
      board: empty,
      turn: 'black',
      capturedBlack: 0,
      capturedWhite: 0,
      lastMove: null,
      history: [getBoardSnapshot(empty)]
    };
  });

  const [gameMode, setGameMode] = useState<GameMode>('pvp');
  const [aiLevel, setAiLevel] = useState<AILevel>('normal');
  const [isThinking, setIsThinking] = useState(false);
  const [hintMove, setHintMove] = useState<{r:number, c:number} | null>(null);
  
  const [showSizeMenu, setShowSizeMenu] = useState(false);
  const [showAiMenu, setShowAiMenu] = useState(false);
  const [hoveredCell, setHoveredCell] = useState<{ r: number; c: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const getCellFromCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    const size = canvas.width;
    const padding = size / (boardSize + 1);
    const spacing = (size - padding * 2) / (boardSize - 1);

    // Use a small threshold to make clicking easier
    const c = Math.round((x - padding) / spacing);
    const r = Math.round((y - padding) / spacing);

    // Double check bounds after rounding
    if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) return null;

    return { r, c };
  }, [boardSize]);

  const resetGame = useCallback((size: BoardSize = boardSize) => {
    const empty = createEmptyBoard(size);
    setBoardSize(size);
    setGame({
      board: empty,
      turn: 'black',
      capturedBlack: 0,
      capturedWhite: 0,
      lastMove: null,
      history: [getBoardSnapshot(empty)]
    });
    setShowSizeMenu(false);
    setShowAiMenu(false);
    setHoveredCell(null);
    setHintMove(null);
  }, [boardSize]);

  const undoMove = useCallback(() => {
    if (game.history.length <= 1) return;
    const newHistory = [...game.history];
    newHistory.pop(); 
    const prevStateStr = newHistory[newHistory.length - 1];
    const prevStateBoard = JSON.parse(prevStateStr);
    setGame(prev => ({
      ...prev,
      board: prevStateBoard,
      turn: prev.turn === 'black' ? 'white' : 'black',
      lastMove: null, 
      history: newHistory,
    }));
    setHintMove(null);
  }, [game.history]);

  const placeStone = useCallback((r: number, c: number) => {
    if (game.board[r][c] !== null || isThinking) return;

    if (!isValidMove(r, c, game.board, game.turn, game.history, boardSize)) return;

    const newBoard = game.board.map(row => [...row]);
    const currentColor = game.turn;
    const opponentColor = currentColor === 'black' ? 'white' : 'black';
    newBoard[r][c] = currentColor;

    let capturedInThisMove = 0;
    const stonesToRemove: { r: number; c: number }[] = [];
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dr, dc] of dirs) {
      const nr = r + dr; const nc = c + dc;
      if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize) {
        if (newBoard[nr][nc] === opponentColor) {
          const { group, liberties } = getGroup(nr, nc, newBoard, boardSize);
          if (liberties === 0) stonesToRemove.push(...group);
        }
      }
    }
    stonesToRemove.forEach(p => {
      newBoard[p.r][p.c] = null;
      capturedInThisMove++;
    });

    const newSnapshot = getBoardSnapshot(newBoard);
    setGame(prev => ({
      ...prev,
      board: newBoard,
      turn: opponentColor,
      capturedBlack: currentColor === 'white' ? prev.capturedBlack + capturedInThisMove : prev.capturedBlack,
      capturedWhite: currentColor === 'black' ? prev.capturedWhite + capturedInThisMove : prev.capturedWhite,
      lastMove: { r, c },
      history: [...prev.history, newSnapshot]
    }));
    setHintMove(null);
  }, [game, boardSize, isThinking]);

  // AI Turn Logic
  useEffect(() => {
    if (gameMode === 'ai' && game.turn === 'white' && !isThinking) {
      setIsThinking(true);
      const delay = aiLevel === 'easy' ? 500 : aiLevel === 'normal' ? 1000 : 1500;
      
      const timer = setTimeout(async () => {
        let move: {r:number, c:number} | null = null;
        switch(aiLevel) {
          case 'easy': move = AI_ENGINE.easy(game.board, 'white', game.history, boardSize); break;
          case 'normal': move = AI_ENGINE.normal(game.board, 'white', game.history, boardSize); break;
          case 'hard': move = await AI_ENGINE.mcts(game.board, 'white', game.history, boardSize, 600); break;
          case 'god': move = await AI_ENGINE.mcts(game.board, 'white', game.history, boardSize, 2500); break;
        }
        if (move) placeStone(move.r, move.c);
        setIsThinking(false);
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [game.turn, gameMode, aiLevel, game.board, game.history, boardSize, isThinking, placeStone]);

  const requestHint = async () => {
    if (isThinking) return;
    setIsThinking(true);
    const best = await AI_ENGINE.mcts(game.board, game.turn, game.history, boardSize, 1500);
    setHintMove(best);
    setIsThinking(false);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCellFromCoords(e.clientX, e.clientY);
    if (coords && coords.r >= 0 && coords.r < boardSize && coords.c >= 0 && coords.c < boardSize) {
      placeStone(coords.r, coords.c);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCellFromCoords(e.clientX, e.clientY);
    if (coords && coords.r >= 0 && coords.r < boardSize && coords.c >= 0 && coords.c < boardSize) {
      setHoveredCell(coords);
    } else {
      setHoveredCell(null);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = canvas.width;
    const padding = size / (boardSize + 1);
    const spacing = (size - padding * 2) / (boardSize - 1);

    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = '#3d2b1f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < boardSize; i++) {
        ctx.moveTo(padding + i * spacing, padding); ctx.lineTo(padding + i * spacing, size - padding);
        ctx.moveTo(padding, padding + i * spacing); ctx.lineTo(size - padding, padding + i * spacing);
    }
    ctx.stroke();

    const hoshi = [];
    if (boardSize === 19) {
      const pts = [3, 9, 15];
      for (const r of pts) for (const c of pts) hoshi.push({ r, c });
    } else if (boardSize === 13) {
      hoshi.push({ r: 3, c: 3 }, { r: 3, c: 9 }, { r: 9, c: 3 }, { r: 9, c: 9 }, { r: 6, c: 6 });
    } else if (boardSize === 9) {
      hoshi.push({ r: 2, c: 2 }, { r: 2, c: 6 }, { r: 6, c: 2 }, { r: 6, c: 6 }, { r: 4, c: 4 });
    }
    ctx.fillStyle = '#3d2b1f';
    hoshi.forEach(p => { ctx.beginPath(); ctx.arc(padding + p.c * spacing, padding + p.r * spacing, 3, 0, Math.PI * 2); ctx.fill(); });

    game.board.forEach((row, r) => {
      row.forEach((stone, c) => {
        if (!stone) return;
        const x = padding + c * spacing;
        const y = padding + r * spacing;
        const radius = spacing * 0.45;
        ctx.beginPath(); ctx.arc(x + 2, y + 2, radius, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
        const grad = ctx.createRadialGradient(x - radius/3, y - radius/3, radius/10, x, y, radius);
        if (stone === 'black') { grad.addColorStop(0, '#444'); grad.addColorStop(1, '#000'); }
        else { grad.addColorStop(0, '#fff'); grad.addColorStop(1, '#ddd'); }
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
        if (game.lastMove?.r === r && game.lastMove?.c === c) {
          ctx.beginPath(); ctx.strokeStyle = stone === 'black' ? '#fff' : '#f00'; ctx.lineWidth = 2; ctx.arc(x, y, radius / 3, 0, Math.PI * 2); ctx.stroke();
        }
      });
    });

    if (hoveredCell && game.board[hoveredCell.r]?.[hoveredCell.c] === null) {
      const x = padding + hoveredCell.c * spacing;
      const y = padding + hoveredCell.r * spacing;
      const radius = spacing * 0.42;

      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = '#f97316'; 
      ctx.lineWidth = 3;
      ctx.stroke();
      
      ctx.fillStyle = 'rgba(249, 115, 22, 0.4)';
      ctx.fill();
      ctx.restore();
    }

    if (hintMove) {
       const x = padding + hintMove.c * spacing;
       const y = padding + hintMove.r * spacing;
       ctx.save(); ctx.beginPath(); ctx.arc(x, y, spacing * 0.35, 0, Math.PI * 2);
       ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 4; ctx.stroke();
       ctx.fillStyle = 'rgba(59, 130, 246, 0.4)'; ctx.fill(); ctx.restore();
    }
  }, [game, boardSize, hoveredCell, hintMove]);

  return (
    <div className="min-h-screen bg-[#121212] p-4 flex flex-col items-center">
      <header className="w-full max-w-2xl flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-[#DEB887] p-2 rounded-xl shadow-lg"><Trophy className="text-[#3d2b1f]" /></div>
          <div><h1 className="text-xl font-bold text-white">Go Master AI</h1><p className="text-[10px] text-gray-500 uppercase tracking-tighter">Professional Go Engine</p></div>
        </div>
        <div className="flex gap-2">
            <button onClick={() => {setGameMode('ai'); setShowAiMenu(!showAiMenu);}} className={`p-2 rounded-xl transition-all border ${gameMode==='ai'?'bg-amber-500 border-amber-600 text-black':'bg-white/5 border-white/10 text-white'}`}><Cpu className="w-5 h-5"/></button>
            <button onClick={() => {setGameMode('pvp'); setShowAiMenu(false);}} className={`p-2 rounded-xl transition-all border ${gameMode==='pvp'?'bg-white/20 border-white/30 text-white':'bg-white/5 border-white/10 text-white'}`}><User className="w-5 h-5"/></button>
        </div>
      </header>

      <main className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
        <div className="relative">
          <AnimatePresence>
            {showAiMenu && (
              <motion.div initial={{opacity:0, scale:0.95}} animate={{opacity:1, scale:1}} exit={{opacity:0, scale:0.95}} className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm rounded-2xl">
                <div className="bg-gray-800 border border-white/10 p-6 rounded-3xl shadow-2xl w-full max-w-sm">
                  <div className="flex items-center gap-2 mb-6"><Brain className="text-amber-500"/><h2 className="text-white font-bold text-lg">AI 난이도 선택</h2></div>
                  <div className="grid grid-cols-1 gap-3">
                    {(['easy', 'normal', 'hard', 'god'] as AILevel[]).map(lvl => (
                      <button key={lvl} onClick={()=>{setAiLevel(lvl); setShowAiMenu(false); setGameMode('ai');}} className={`py-4 rounded-2xl text-sm font-bold border transition-all ${aiLevel===lvl?'bg-amber-500 border-amber-600 text-black shadow-lg shadow-amber-500/20':'bg-white/5 border-white/10 text-white hover:bg-white/10'}`}>
                        {lvl.toUpperCase()} {lvl==='easy'?'(쉬움)':lvl==='normal'?'(보통)':lvl==='hard'?'(어려움)':'(신의 수)'}
                      </button>
                    ))}
                  </div>
                  <button onClick={()=>setShowAiMenu(false)} className="mt-6 w-full text-xs text-gray-500 hover:text-white transition-colors">닫기</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="wood-texture p-4 md:p-8 rounded-3xl shadow-2xl flex items-center justify-center relative overflow-hidden">
            <canvas 
              ref={canvasRef} 
              width={800} 
              height={800} 
              onClick={handleCanvasClick} 
              onMouseMove={handleMouseMove} 
              onMouseLeave={()=>setHoveredCell(null)} 
              className="w-full h-full max-w-[600px] cursor-crosshair touch-none z-10" 
            />
            <AnimatePresence>
              {isThinking && (
                <motion.div initial={{y:20, opacity:0}} animate={{y:0, opacity:1}} exit={{y:20, opacity:0}} className="absolute bottom-12 flex items-center gap-3 bg-amber-500 px-6 py-3 rounded-full shadow-2xl ring-4 ring-black/20">
                  <div className="w-2 h-2 bg-black rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-black rounded-full animate-bounce delay-100" />
                  <div className="w-2 h-2 bg-black rounded-full animate-bounce delay-200" />
                  <span className="text-xs font-black text-black">AI 수 읽기 중...</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          
          <div className="mt-6 flex justify-center gap-4">
            <button onClick={()=>setShowSizeMenu(!showSizeMenu)} className="bg-white/5 border border-white/10 px-6 py-2 rounded-xl text-xs font-bold text-white uppercase tracking-widest hover:bg-white/10 transition-colors">Size: {boardSize}x{boardSize}</button>
            {showSizeMenu && <div className="flex gap-2">{[9,13,19].map(s=><button key={s} onClick={()=>resetGame(s as BoardSize)} className="bg-amber-500 text-black px-4 py-2 rounded-xl text-xs font-bold">{s}</button>)}</div>}
          </div>
        </div>

        <aside className="flex flex-col gap-4">
          <div className="bg-white/5 border border-white/10 p-6 rounded-3xl flex flex-col items-center">
            <span className="text-[10px] text-gray-500 font-bold mb-4 uppercase tracking-widest">Global Status</span>
            <div className="flex gap-6 items-center">
              <motion.div animate={{scale:game.turn==='black'?1.2:0.9, opacity:game.turn==='black'?1:0.4}} className={`w-14 h-14 rounded-full shadow-2xl bg-black border-2 ${game.turn==='black'?'border-amber-500':'border-transparent'}`} />
              <motion.div animate={{scale:game.turn==='white'?1.2:0.9, opacity:game.turn==='white'?1:0.4}} className={`w-14 h-14 rounded-full shadow-2xl bg-white border-2 ${game.turn==='white'?'border-amber-500':'border-transparent'}`} />
            </div>
            <div className="mt-6 text-center">
               <h3 className="text-white font-bold">{game.turn==='black'?'흑돌 차례':'백돌 차례'}</h3>
               <p className="text-[10px] text-amber-500/80 font-mono mt-1 uppercase tracking-tighter">{gameMode==='ai' ? `AI MODE: ${aiLevel}` : 'PVP MODE'}</p>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 p-6 rounded-3xl">
            <div className="flex justify-between items-center mb-4"><span className="text-[10px] font-bold text-gray-400 uppercase">Captured</span><Info className="w-3 h-3 text-gray-500"/></div>
            <div className="space-y-4">
              <div className="flex justify-between items-center"><div className="flex items-center gap-3"><div className="w-3 h-3 rounded-full bg-black ring-1 ring-white/10"/><span className="text-sm text-gray-300">Black Captured</span></div><span className="font-mono text-xl text-white">{game.capturedWhite}</span></div>
              <div className="flex justify-between items-center"><div className="flex items-center gap-3"><div className="w-3 h-3 rounded-full bg-white ring-1 ring-black/10"/><span className="text-sm text-gray-300">White Captured</span></div><span className="font-mono text-xl text-white">{game.capturedBlack}</span></div>
            </div>
          </div>

          <div className="mt-auto grid grid-cols-1 gap-3">
            <button onClick={requestHint} disabled={isThinking} className="flex items-center justify-center gap-3 py-4 bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-2xl hover:bg-blue-500/20 transition-all font-bold disabled:opacity-30"><Brain className="w-5 h-5"/>신의 한 수 (Hint)</button>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={undoMove} disabled={game.history.length<=1 || isThinking} className="flex items-center justify-center gap-2 py-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all text-sm font-bold text-white disabled:opacity-20"><Undo2 className="w-4 h-4"/> 무르기</button>
              <button onClick={()=>resetGame()} className="flex items-center justify-center gap-2 py-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-red-500/10 border-red-500/20 text-red-400 font-bold"><RotateCcw className="w-4 h-4"/> Reset</button>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
