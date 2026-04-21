// 倉庫番 Sokoban — 遊戲邏輯
(function () {
  "use strict";

  const STORAGE_KEY = "sokoban:progress:v1";
  const LAST_LEVEL_KEY = "sokoban:last-level:v1";
  const DIFFICULTY_TEXT = {
    easy: "簡單",
    medium: "中等",
    hard: "困難",
    expert: "挑戰",
  };

  // ---------- 進度儲存 ----------
  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }
  function saveProgress(p) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  }
  function getLastLevel() {
    const n = parseInt(localStorage.getItem(LAST_LEVEL_KEY), 10);
    return Number.isFinite(n) ? n : 0;
  }
  function setLastLevel(idx) {
    localStorage.setItem(LAST_LEVEL_KEY, String(idx));
  }

  // ---------- 關卡解析 ----------
  function parseLevel(levelDef) {
    const rows = levelDef.map.slice();
    const h = rows.length;
    const w = rows.reduce((m, r) => Math.max(m, r.length), 0);

    const wall = Array.from({ length: h }, () => new Array(w).fill(false));
    const target = Array.from({ length: h }, () => new Array(w).fill(false));
    const outside = Array.from({ length: h }, () => new Array(w).fill(false));
    const boxes = new Set();
    let player = null;

    for (let y = 0; y < h; y++) {
      const row = rows[y].padEnd(w, " ");
      for (let x = 0; x < w; x++) {
        const ch = row[x];
        switch (ch) {
          case "#":
            wall[y][x] = true;
            break;
          case ".":
            target[y][x] = true;
            break;
          case "$":
            boxes.add(key(y, x));
            break;
          case "*":
            boxes.add(key(y, x));
            target[y][x] = true;
            break;
          case "@":
            player = [y, x];
            break;
          case "+":
            player = [y, x];
            target[y][x] = true;
            break;
        }
      }
    }

    // 用 flood-fill 從邊界標記「外部」空地，避免渲染成地板
    const q = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if ((y === 0 || y === h - 1 || x === 0 || x === w - 1) && !wall[y][x]) {
          const ch = rows[y].padEnd(w, " ")[x];
          if (ch === " ") {
            outside[y][x] = true;
            q.push([y, x]);
          }
        }
      }
    }
    while (q.length) {
      const [y, x] = q.shift();
      for (const [dy, dx] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const ny = y + dy, nx = x + dx;
        if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
        if (outside[ny][nx] || wall[ny][nx]) continue;
        // 如果該格有目標或箱子或玩家，不算外部
        const row = rows[ny].padEnd(w, " ");
        const ch = row[nx];
        if (ch !== " ") continue;
        outside[ny][nx] = true;
        q.push([ny, nx]);
      }
    }

    return {
      w, h, wall, target, outside,
      boxes, player,
      totalTargets: target.flat().filter(Boolean).length,
    };
  }

  function key(y, x) { return y + "," + x; }
  function unkey(k) { return k.split(",").map(Number); }

  // ---------- 遊戲狀態 ----------
  const state = {
    levelIdx: 0,
    level: null,
    boxes: null,     // Set<string>
    player: null,    // [y,x]
    moves: 0,
    pushes: 0,
    history: [],     // [{dy,dx,pushed}]
    won: false,
  };

  function loadLevel(idx) {
    const def = LEVELS[idx];
    if (!def) return;
    const parsed = parseLevel(def);
    state.levelIdx = idx;
    state.level = { ...parsed, name: def.name, difficulty: def.difficulty };
    state.boxes = new Set(parsed.boxes);
    state.player = parsed.player.slice();
    state.moves = 0;
    state.pushes = 0;
    state.history = [];
    state.won = false;
    setLastLevel(idx);
    renderBoard();
    updateStats();
    updateHeader();
    document.getElementById("btn-next").disabled = true;
  }

  function tryMove(dy, dx) {
    if (state.won) return;
    const [py, px] = state.player;
    const ny = py + dy, nx = px + dx;
    if (!isWalkable(ny, nx, false)) {
      // 可能是箱子，嘗試推
      if (state.boxes.has(key(ny, nx))) {
        const by = ny + dy, bx = nx + dx;
        if (isWalkable(by, bx, true)) {
          state.boxes.delete(key(ny, nx));
          state.boxes.add(key(by, bx));
          state.player = [ny, nx];
          state.moves++;
          state.pushes++;
          state.history.push({ dy, dx, pushed: true });
          afterMove();
        }
      }
      return;
    }
    state.player = [ny, nx];
    state.moves++;
    state.history.push({ dy, dx, pushed: false });
    afterMove();
  }

  function isWalkable(y, x, allowOnBox) {
    const lv = state.level;
    if (y < 0 || y >= lv.h || x < 0 || x >= lv.w) return false;
    if (lv.wall[y][x]) return false;
    if (lv.outside[y][x]) return false;
    if (!allowOnBox && state.boxes.has(key(y, x))) return false;
    if (allowOnBox && state.boxes.has(key(y, x))) return false;
    return true;
  }

  function undo() {
    if (!state.history.length || state.won) return;
    const last = state.history.pop();
    const [py, px] = state.player;
    const prevY = py - last.dy, prevX = px - last.dx;
    if (last.pushed) {
      // 箱子從 (py+dy, px+dx) 移回 (py, px)
      const bFrom = key(py + last.dy, px + last.dx);
      const bTo = key(py, px);
      state.boxes.delete(bFrom);
      state.boxes.add(bTo);
      state.pushes = Math.max(0, state.pushes - 1);
    }
    state.player = [prevY, prevX];
    state.moves = Math.max(0, state.moves - 1);
    updateStats();
    renderPieces();
  }

  function reset() {
    loadLevel(state.levelIdx);
  }

  function afterMove() {
    updateStats();
    renderPieces();
    if (checkWin()) {
      state.won = true;
      onWin();
    }
  }

  function checkWin() {
    const lv = state.level;
    for (const bk of state.boxes) {
      const [y, x] = unkey(bk);
      if (!lv.target[y][x]) return false;
    }
    return state.boxes.size === lv.totalTargets;
  }

  function onWin() {
    const progress = loadProgress();
    const key = "level_" + state.levelIdx;
    const prev = progress[key] || {};
    const best = {
      completed: true,
      bestMoves: Math.min(prev.bestMoves ?? Infinity, state.moves),
      bestPushes: Math.min(prev.bestPushes ?? Infinity, state.pushes),
    };
    const isNewRecord =
      !prev.completed ||
      state.moves < (prev.bestMoves ?? Infinity) ||
      state.pushes < (prev.bestPushes ?? Infinity);
    progress[key] = best;
    saveProgress(progress);
    showWinModal(isNewRecord, best);
    document.getElementById("btn-next").disabled = state.levelIdx >= LEVELS.length - 1;
  }

  // ---------- 畫面渲染 ----------
  const boardEl = () => document.getElementById("board");

  function renderBoard() {
    const lv = state.level;
    const board = boardEl();
    board.style.gridTemplateColumns = `repeat(${lv.w}, var(--cell))`;
    board.innerHTML = "";
    for (let y = 0; y < lv.h; y++) {
      for (let x = 0; x < lv.w; x++) {
        const div = document.createElement("div");
        div.className = "cell";
        div.dataset.y = y;
        div.dataset.x = x;
        if (lv.outside[y][x]) {
          div.classList.add("outside");
          div.style.visibility = "hidden";
        } else if (lv.wall[y][x]) {
          div.classList.add("wall");
        } else {
          div.classList.add("floor");
          if (lv.target[y][x]) div.classList.add("target");
        }
        board.appendChild(div);
      }
    }
    renderPieces();
  }

  function renderPieces() {
    const lv = state.level;
    // 清掉 piece
    boardEl().querySelectorAll(".piece").forEach((e) => e.remove());

    // 箱子
    for (const bk of state.boxes) {
      const [y, x] = unkey(bk);
      const cell = cellAt(y, x);
      if (!cell) continue;
      const span = document.createElement("span");
      const onTarget = lv.target[y][x];
      span.className = "piece " + (onTarget ? "box-on" : "box");
      span.textContent = onTarget ? "✅" : "📦";
      cell.appendChild(span);
    }

    // 玩家
    const [py, px] = state.player;
    const pc = cellAt(py, px);
    if (pc) {
      const span = document.createElement("span");
      span.className = "piece player";
      span.textContent = "🧑";
      pc.appendChild(span);
    }
  }

  function cellAt(y, x) {
    return boardEl().querySelector(`.cell[data-y="${y}"][data-x="${x}"]`);
  }

  function updateStats() {
    document.getElementById("stat-moves").textContent = state.moves;
    document.getElementById("stat-pushes").textContent = state.pushes;
  }

  function updateHeader() {
    document.getElementById("level-name").textContent = state.level.name;
    const dEl = document.getElementById("level-diff");
    dEl.textContent = DIFFICULTY_TEXT[state.level.difficulty];
    dEl.className = "diff-badge " + state.level.difficulty;
  }

  // ---------- 畫面切換 ----------
  function show(screenId) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    document.getElementById(screenId).classList.add("active");
    document.body.classList.toggle("playing", screenId === "game-screen");
  }

  function buildLevelGrid() {
    const grid = document.getElementById("level-grid");
    grid.innerHTML = "";
    const progress = loadProgress();
    LEVELS.forEach((lv, idx) => {
      const btn = document.createElement("button");
      btn.className = "level-tile " + lv.difficulty;
      const done = progress["level_" + idx]?.completed;
      if (done) btn.classList.add("done");
      btn.innerHTML = `
        <div class="num">${idx + 1}</div>
        <div class="status">${done ? "⭐" : ""}</div>
        <div class="diff-badge ${lv.difficulty}" style="display:inline-block;margin-top:4px;">${DIFFICULTY_TEXT[lv.difficulty]}</div>
        ${done ? `<div class="best">最佳 ${progress["level_" + idx].bestMoves} 步</div>` : ""}
      `;
      btn.addEventListener("click", () => {
        loadLevel(idx);
        show("game-screen");
      });
      grid.appendChild(btn);
    });
  }

  // ---------- 過關彈窗 ----------
  function showWinModal(isNewRecord, best) {
    document.getElementById("win-moves").textContent = state.moves;
    document.getElementById("win-pushes").textContent = state.pushes;
    const bestEl = document.getElementById("win-best");
    bestEl.textContent = isNewRecord
      ? "🏆 新紀錄！"
      : `本關最佳：${best.bestMoves} 步 / ${best.bestPushes} 推`;
    document.getElementById("win-modal").hidden = false;
    const nextBtn = document.getElementById("win-next");
    nextBtn.disabled = state.levelIdx >= LEVELS.length - 1;
    nextBtn.textContent = nextBtn.disabled ? "沒有下一關了" : "下一關 →";
  }
  function hideWinModal() {
    document.getElementById("win-modal").hidden = true;
  }

  // ---------- 事件綁定 ----------
  function bindEvents() {
    // 鍵盤
    document.addEventListener("keydown", (e) => {
      if (document.getElementById("game-screen").classList.contains("active") === false) return;
      if (document.getElementById("win-modal").hidden === false) {
        if (e.key === "Enter") nextOrMenu();
        return;
      }
      const k = e.key;
      if (k === "ArrowUp" || k === "w" || k === "W") { tryMove(-1, 0); e.preventDefault(); }
      else if (k === "ArrowDown" || k === "s" || k === "S") { tryMove(1, 0); e.preventDefault(); }
      else if (k === "ArrowLeft" || k === "a" || k === "A") { tryMove(0, -1); e.preventDefault(); }
      else if (k === "ArrowRight" || k === "d" || k === "D") { tryMove(0, 1); e.preventDefault(); }
      else if (k === "z" || k === "Z") { undo(); e.preventDefault(); }
      else if (k === "r" || k === "R") { reset(); e.preventDefault(); }
    });

    // 觸控方向鍵（用 pointerdown 立即回饋；preventDefault 避免雙重觸發）
    document.querySelectorAll(".tpad").forEach((b) => {
      const handler = (e) => {
        e.preventDefault();
        b.blur();
        const d = b.dataset.dir;
        if (d === "up") tryMove(-1, 0);
        else if (d === "down") tryMove(1, 0);
        else if (d === "left") tryMove(0, -1);
        else if (d === "right") tryMove(0, 1);
      };
      b.addEventListener("pointerdown", handler);
    });

    // 畫面切換 / 主選單
    document.getElementById("btn-levels").addEventListener("click", () => {
      buildLevelGrid();
      show("levels-screen");
    });
    document.getElementById("btn-howto").addEventListener("click", () => show("howto-screen"));
    document.getElementById("btn-continue").addEventListener("click", () => {
      const idx = getLastLevel();
      loadLevel(idx);
      show("game-screen");
    });
    document.querySelectorAll("[data-back]").forEach((b) => {
      b.addEventListener("click", () => {
        const t = b.dataset.back;
        if (t === "levels") { buildLevelGrid(); show("levels-screen"); }
        else show("menu-screen");
      });
    });

    // 遊戲按鈕
    document.getElementById("btn-undo").addEventListener("click", undo);
    document.getElementById("btn-reset").addEventListener("click", reset);
    document.getElementById("btn-next").addEventListener("click", goNext);

    // 過關彈窗
    document.getElementById("win-retry").addEventListener("click", () => { hideWinModal(); reset(); });
    document.getElementById("win-menu").addEventListener("click", () => { hideWinModal(); buildLevelGrid(); show("levels-screen"); });
    document.getElementById("win-next").addEventListener("click", () => { hideWinModal(); goNext(); });

    // 清除進度
    document.getElementById("btn-reset-progress").addEventListener("click", () => {
      if (confirm("確定要清除所有關卡進度嗎？這個動作無法復原喔！")) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LAST_LEVEL_KEY);
        buildLevelGrid();
      }
    });
  }

  function goNext() {
    if (state.levelIdx < LEVELS.length - 1) {
      loadLevel(state.levelIdx + 1);
    }
  }

  function nextOrMenu() {
    hideWinModal();
    if (state.levelIdx < LEVELS.length - 1) goNext();
    else { buildLevelGrid(); show("levels-screen"); }
  }

  // ---------- 初始化 ----------
  function init() {
    bindEvents();
    // 更新「繼續遊戲」按鈕狀態
    const hasProgress = localStorage.getItem(LAST_LEVEL_KEY) !== null;
    const cont = document.getElementById("btn-continue");
    if (!hasProgress) {
      cont.textContent = "開始遊戲";
      cont.addEventListener("click", () => {
        loadLevel(0);
        show("game-screen");
      }, { once: true });
    }
    show("menu-screen");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
