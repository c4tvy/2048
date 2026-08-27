function GameManager(size, InputManager, Actuator, StorageManager) {
  this.size           = size;
  this.inputManager   = new InputManager;
  this.storageManager = new StorageManager;
  this.actuator       = new Actuator;

  this.startTiles     = 2;
  this.moveAnimationTime = 130;
  this.moveInProgress = false;
  this.moveInProgressTimer = null;

  this.history = [];

  // 高级模式状态
  this.advancedMode = false;
  this.waitingForSequence = false;
  this.sequenceIndex = 0;
  this.sequenceClickCount = 0;
  this.noMoveTimer = null;
  this.sequenceTargets = [
    { x: 0, y: 0, need: 1 },
    { x: 3, y: 0, need: 2 },
    { x: 0, y: 3, need: 3 },
    { x: 3, y: 3, need: 4 }
  ];

  this.gameContainer = document.querySelector('.game-container');
  this.tileContainer = document.querySelector('.tile-container');

  // 计时器相关
  this.timerElement = document.getElementById('game-timer');
  this.timerInterval = null;
  this.elapsedSeconds = 0;
  this.timerRunning = false;
  this.timerStartTime = 0;

  this.bindContainerClick();

  // 退出高级模式按钮
  var exitBtn = document.getElementById('exit-advanced-btn');
  if (exitBtn) {
    exitBtn.addEventListener('click', function(e) {
      e.preventDefault();
      this.exitAdvancedMode();
    }.bind(this));
  }

  // 重置最高分按钮
  var resetBestBtn = document.getElementById('reset-best-btn');
  if (resetBestBtn) {
    resetBestBtn.addEventListener('click', function(e) {
      e.preventDefault();
      this.resetBestScore();
    }.bind(this));
  }

  this.bindScoreEditing();

  this.inputManager.on("move", this.move.bind(this));
  this.inputManager.on("restart", this.restart.bind(this));
  this.inputManager.on("keepPlaying", this.keepPlaying.bind(this));

  this.setup();
}

// ---------- 辅助函数 ----------
GameManager.prototype.nextPowerOfTwo = function(n) {
  if (n <= 2) return 2;
  var p = 2;
  while (p < n) p *= 2;
  return p;
};

GameManager.prototype.prevPowerOfTwo = function(n) {
  if (n <= 2) return 2;
  var p = 2;
  while (p * 2 < n) p *= 2;
  return p;
};

GameManager.prototype.isPowerOfTwo = function(n) {
  if (n <= 0) return false;
  return (n & (n - 1)) === 0;
};

// ---------- 计时器 ----------
GameManager.prototype.startTimer = function() {
  if (this.timerRunning) return;
  if (this.isGameTerminated()) return;
  this.timerRunning = true;
  this.timerStartTime = Date.now() - this.elapsedSeconds * 1000;
  this.timerInterval = setInterval(this.updateTimerDisplay.bind(this), 1000);
  this.updateTimerDisplay();
  this.saveState();
};

GameManager.prototype.stopTimer = function() {
  if (!this.timerRunning) return;
  this.timerRunning = false;
  clearInterval(this.timerInterval);
  this.timerInterval = null;
  this.elapsedSeconds = Math.floor((Date.now() - this.timerStartTime) / 1000);
  this.saveState();
};

GameManager.prototype.resetTimer = function() {
  this.stopTimer();
  this.elapsedSeconds = 0;
  this.timerStartTime = Date.now();
  this.updateTimerDisplay();
  this.saveState();
};

GameManager.prototype.updateTimerDisplay = function() {
  if (!this.timerElement) return;
  var seconds = this.timerRunning ? Math.floor((Date.now() - this.timerStartTime) / 1000) : this.elapsedSeconds;
  var hours = Math.floor(seconds / 3600);
  var mins = Math.floor((seconds % 3600) / 60);
  var secs = seconds % 60;
  this.timerElement.textContent = (hours < 10 ? '0' : '') + hours + ':' +
                                   (mins < 10 ? '0' : '') + mins + ':' +
                                   (secs < 10 ? '0' : '') + secs;
  if (this.timerRunning) {
    this.elapsedSeconds = seconds;
    this.saveState();
  }
};

GameManager.prototype.setTimerSeconds = function(seconds) {
  if (isNaN(seconds) || seconds < 0) return;
  if (this.timerRunning) {
    this.elapsedSeconds = seconds;
    this.timerStartTime = Date.now() - this.elapsedSeconds * 1000;
  } else {
    this.elapsedSeconds = seconds;
  }
  this.updateTimerDisplay();
  this.saveState();
};

GameManager.prototype.saveState = function() {
  if (this.over) {
    this.storageManager.clearGameState();
  } else {
    this.storageManager.setGameState(this.serialize());
  }
};

GameManager.prototype.serialize = function () {
  return {
    grid: this.grid.serialize(),
    score: this.score,
    over: this.over,
    won: this.won,
    keepPlaying: this.keepPlaying,
    timerSeconds: this.elapsedSeconds
  };
};

// ---------- 重置最高分 ----------
GameManager.prototype.resetBestScore = function() {
  this.storageManager.setBestScore(0, true);
  this.actuator.updateBestScore(0);
  this.score = 0;
  this.actuator.updateScore(0);
  this.saveState();
};

// ---------- 高级模式 ----------
GameManager.prototype.bindContainerClick = function() {
  if (!this.gameContainer) return;
  var self = this;
  this.gameContainer.addEventListener('pointerdown', function(e) {
    if (self.waitingForSequence) {
      e.preventDefault();
      self.handleSequenceClick(e);
    }
  });
};

GameManager.prototype.startNoMoveTimer = function() {
  if (this.advancedMode) return;
  var self = this;
  if (this.noMoveTimer) clearTimeout(this.noMoveTimer);
  this.noMoveTimer = setTimeout(function() {
    self.waitingForSequence = true;
    self.sequenceIndex = 0;
    self.sequenceClickCount = 0;
    self.noMoveTimer = null;
  }, 10000);
};

GameManager.prototype.cancelNoMoveTimer = function() {
  if (this.noMoveTimer) {
    clearTimeout(this.noMoveTimer);
    this.noMoveTimer = null;
  }
  if (this.waitingForSequence) {
    this.waitingForSequence = false;
  }
};

GameManager.prototype.handleSequenceClick = function(e) {
  if (!this.waitingForSequence) return;

  var gridContainer = document.querySelector('.grid-container');
  var gridCell = document.querySelector('.grid-cell');
  if (!gridContainer || !gridCell) return;

  var gridRect = gridContainer.getBoundingClientRect();
  var cellWidth = gridCell.offsetWidth;
  var cellHeight = gridCell.offsetHeight;
  var gap = 15;

  var clientX = e.clientX !== undefined ? e.clientX : e.pageX;
  var clientY = e.clientY !== undefined ? e.clientY : e.pageY;

  var offsetX = clientX - gridRect.left;
  var offsetY = clientY - gridRect.top;
  var col = Math.floor(offsetX / (cellWidth + gap));
  var row = Math.floor(offsetY / (cellHeight + gap));

  if (row < 0 || row >= 4 || col < 0 || col >= 4) return;

  var target = this.sequenceTargets[this.sequenceIndex];
  if (row === target.x && col === target.y) {
    this.sequenceClickCount++;
    if (this.sequenceClickCount >= target.need) {
      this.sequenceIndex++;
      this.sequenceClickCount = 0;
      if (this.sequenceIndex >= this.sequenceTargets.length) {
        this.waitingForSequence = false;
        this.enterAdvancedMode();
      }
    }
  } else {
    this.sequenceIndex = 0;
    this.sequenceClickCount = 0;
  }
};

GameManager.prototype.enterAdvancedMode = function() {
  if (this.advancedMode) return;
  this.advancedMode = true;
  var panel = document.getElementById('advanced-controls');
  if (panel) panel.style.display = 'block';
  var exitBtn = document.getElementById('exit-advanced-btn');
  if (exitBtn) exitBtn.style.display = 'block';
  var gameContainer = document.querySelector('.game-container');
  if (gameContainer) gameContainer.classList.add('advanced-mode');
  this.cancelNoMoveTimer();
  this.stopTimer();

  var hoursInput = document.getElementById('edit-timer-hours');
  var minsInput = document.getElementById('edit-timer-minutes');
  var secsInput = document.getElementById('edit-timer-seconds');
  if (hoursInput && minsInput && secsInput) {
    var hours = Math.floor(this.elapsedSeconds / 3600);
    var mins = Math.floor((this.elapsedSeconds % 3600) / 60);
    var secs = this.elapsedSeconds % 60;
    hoursInput.value = hours;
    minsInput.value = mins;
    secsInput.value = secs;
  }

  this.actuateNoAnimation();
};

GameManager.prototype.exitAdvancedMode = function() {
  if (!this.advancedMode) return;
  this.advancedMode = false;
  var panel = document.getElementById('advanced-controls');
  if (panel) panel.style.display = 'none';
  var exitBtn = document.getElementById('exit-advanced-btn');
  if (exitBtn) exitBtn.style.display = 'none';
  var gameContainer = document.querySelector('.game-container');
  if (gameContainer) gameContainer.classList.remove('advanced-mode');
  this.removeAllControls();
  this.startNoMoveTimer();
  if (!this.isGameTerminated()) {
    this.startTimer();
  }
  this.actuate();
};

// ---------- 编辑功能绑定 ----------
GameManager.prototype.bindScoreEditing = function() {
  var self = this;
  var scoreEl = document.getElementById('score-display');
  var bestEl = document.getElementById('best-score-number');

  if (scoreEl) {
    scoreEl.addEventListener('dblclick', function() {
      if (!self.advancedMode) return;
      var newVal = prompt('修改当前分数：', self.score);
      if (newVal !== null) {
        var val = parseInt(newVal);
        if (!isNaN(val) && val >= 0) {
          self.score = val;
          self.actuator.updateScore(val);
          self.storageManager.setGameState(self.serialize());
        }
      }
    });
  }

  if (bestEl) {
    bestEl.addEventListener('dblclick', function() {
      if (!self.advancedMode) return;
      var newVal = prompt('修改最高分数：', self.storageManager.getBestScore());
      if (newVal !== null) {
        var val = parseInt(newVal);
        if (!isNaN(val) && val >= 0) {
          self.storageManager.setBestScore(val, true);
          self.actuator.updateBestScore(val);
          self.score = val;
          self.actuator.updateScore(val);
          self.saveState();
        }
      }
    });
  }

  // 高级面板按钮
  var scoreBtn = document.getElementById('apply-score-btn');
  if (scoreBtn) {
    scoreBtn.onclick = function() {
      var val = parseInt(document.getElementById('edit-score').value);
      if (!isNaN(val) && val >= 0) {
        self.score = val;
        self.actuator.updateScore(val);
        self.storageManager.setGameState(self.serialize());
      }
    };
  }

  var bestBtn = document.getElementById('apply-best-btn');
  if (bestBtn) {
    bestBtn.onclick = function() {
      var val = parseInt(document.getElementById('edit-best').value);
      if (!isNaN(val) && val >= 0) {
        self.storageManager.setBestScore(val, true);
        self.actuator.updateBestScore(val);
        self.score = val;
        self.actuator.updateScore(val);
        self.saveState();
      }
    };
  }

  var tileBtn = document.getElementById('apply-tile-btn');
  if (tileBtn) {
    tileBtn.onclick = function() {
      var row = parseInt(document.getElementById('tile-row').value);
      var col = parseInt(document.getElementById('tile-col').value);
      var value = parseInt(document.getElementById('tile-value').value);
      if (!isNaN(row) && !isNaN(col) && !isNaN(value) && row >= 0 && row < 4 && col >= 0 && col < 4) {
        if (!self.isPowerOfTwo(value)) {
          alert('方块值必须是 2 的幂（如 2, 4, 8, 16, ...）');
          return;
        }
        var cell = {x: col, y: row};
        var existing = self.grid.cellContent(cell);
        if (existing) self.grid.removeTile(existing);
        if (value > 0) {
          var newTile = new Tile(cell, value);
          self.grid.insertTile(newTile);
        }
        self.actuateNoAnimation();
        self.storageManager.setGameState(self.serialize());
      }
    };
  }

  var timerBtn = document.getElementById('apply-timer-btn');
  if (timerBtn) {
    timerBtn.onclick = function() {
      var hours = parseInt(document.getElementById('edit-timer-hours').value) || 0;
      var mins = parseInt(document.getElementById('edit-timer-minutes').value) || 0;
      var secs = parseInt(document.getElementById('edit-timer-seconds').value) || 0;
      var totalSeconds = hours * 3600 + mins * 60 + secs;
      if (totalSeconds >= 0) {
        self.setTimerSeconds(totalSeconds);
      }
    };
  }
};

// ---------- 控件管理 ----------
GameManager.prototype.addTileControls = function() {
  var self = this;
  this.removeAllControls();

  var cells = document.querySelectorAll('.grid-cell');
  var isMobile = window.innerWidth < 520;

  cells.forEach(function(cell, index) {
    var row = Math.floor(index / 4);
    var col = index % 4;
    var tile = self.grid.cellContent({x: col, y: row});

    var refEl = null;
    var tileEl = null;
    if (tile) {
      tileEl = document.querySelector('.tile[data-x="' + col + '"][data-y="' + row + '"]');
      if (tileEl) refEl = tileEl;
    }
    if (!refEl) refEl = cell;

    var size = refEl.offsetWidth;
    var btnSize = size * 0.125;
    var gapSize = size * 0.0625;
    var fontSize = Math.max(8, btnSize * 0.5);

    var controls = document.createElement('div');
    controls.className = 'tile-controls';
    controls.style.position = 'absolute';
    controls.style.bottom = '4px';
    controls.style.right = '4px';
    controls.style.zIndex = '20';
    controls.style.pointerEvents = 'none';
    controls.style.display = 'flex';
    controls.style.flexDirection = 'column';
    controls.style.gap = gapSize + 'px';

    var btnStyle = {
      pointerEvents: 'auto',
      width: btnSize + 'px',
      height: btnSize + 'px',
      fontSize: fontSize + 'px',
      padding: '0',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      lineHeight: btnSize + 'px',
      textAlign: 'center',
      color: '#fff',
      touchAction: 'none',
      userSelect: 'none',
      boxSizing: 'border-box'
    };

    if (tile) {
      if (!tileEl) return;

      var up = document.createElement('button');
      Object.assign(up.style, btnStyle);
      up.textContent = '▲';
      up.className = 'tile-up';
      up.style.background = 'rgba(50,50,200,0.85)';
      up.addEventListener('pointerdown', function(e) {
        e.preventDefault();
        e.stopPropagation();
        self.changeTileValue(row, col, 1);
      });

      var down = document.createElement('button');
      Object.assign(down.style, btnStyle);
      down.textContent = '▼';
      down.className = 'tile-down';
      down.style.background = 'rgba(200,200,50,0.85)';
      down.addEventListener('pointerdown', function(e) {
        e.preventDefault();
        e.stopPropagation();
        self.changeTileValue(row, col, -1);
      });

      var del = document.createElement('button');
      Object.assign(del.style, btnStyle);
      del.textContent = '×';
      del.className = 'tile-del';
      del.style.background = 'rgba(200,50,50,0.85)';
      del.addEventListener('pointerdown', function(e) {
        e.preventDefault();
        e.stopPropagation();
        self.removeTileAt(row, col);
      });

      controls.appendChild(up);
      controls.appendChild(down);
      controls.appendChild(del);

      var inner = tileEl.querySelector('.tile-inner');
      if (inner) {
        tileEl.insertBefore(controls, inner.nextSibling);
      } else {
        tileEl.appendChild(controls);
      }
    } else {
      controls.style.zIndex = '5';
      var gen = document.createElement('button');
      Object.assign(gen.style, btnStyle);
      gen.textContent = '+';
      gen.className = 'tile-gen';
      gen.style.background = 'rgba(50,200,50,0.85)';
      gen.addEventListener('pointerdown', function(e) {
        e.preventDefault();
        e.stopPropagation();
        self.generateTileAt(row, col);
      });
      controls.appendChild(gen);
      cell.style.position = 'relative';
      cell.appendChild(controls);
    }
  });
};

GameManager.prototype.removeAllControls = function() {
  document.querySelectorAll('.tile-controls').forEach(function(el) { el.remove(); });
};

// ---------- 方块值修改 ----------
GameManager.prototype.changeTileValue = function(row, col, delta) {
  var tile = this.grid.cellContent({x: col, y: row});
  if (!tile) return;
  var current = tile.value;
  var newVal;
  if (delta > 0) {
    newVal = this.nextPowerOfTwo(current + 1);
  } else {
    if (current <= 2) {
      newVal = 2;
    } else {
      newVal = this.prevPowerOfTwo(current - 1);
    }
  }
  if (newVal === current) return;
  this.grid.removeTile(tile);
  var newTile = new Tile({x: col, y: row}, newVal);
  this.grid.insertTile(newTile);
  this.actuateNoAnimation();
  this.storageManager.setGameState(this.serialize());
};

GameManager.prototype.removeTileAt = function(row, col) {
  var tile = this.grid.cellContent({x: col, y: row});
  if (!tile) return;
  this.grid.removeTile(tile);
  this.actuateNoAnimation();
  this.storageManager.setGameState(this.serialize());
};

GameManager.prototype.generateTileAt = function(row, col) {
  var existing = this.grid.cellContent({x: col, y: row});
  if (existing) this.grid.removeTile(existing);
  var newTile = new Tile({x: col, y: row}, 2);
  this.grid.insertTile(newTile);
  this.actuateNoAnimation();
  this.storageManager.setGameState(this.serialize());
};

// ---------- 渲染 ----------
GameManager.prototype.actuateNoAnimation = function () {
  if (this.storageManager.getBestScore() < this.score) {
    this.storageManager.setBestScore(this.score);
  }
  this.saveState();
  this.actuator.actuate(this.grid, {
    score: this.score,
    over: this.over,
    won: this.won,
    bestScore: this.storageManager.getBestScore(),
    terminated: this.isGameTerminated(),
    noAnimation: true
  });

  if (this.advancedMode) {
    var self = this;
    requestAnimationFrame(function() {
      self.addTileControls();
    });
  }
};

GameManager.prototype.actuate = function () {
  if (this.storageManager.getBestScore() < this.score) {
    this.storageManager.setBestScore(this.score);
  }
  this.saveState();
  this.actuator.actuate(this.grid, {
    score: this.score,
    over: this.over,
    won: this.won,
    bestScore: this.storageManager.getBestScore(),
    terminated: this.isGameTerminated()
  });
};

// ---------- 核心移动 ----------
GameManager.prototype.move = function (direction) {
  if (this.advancedMode) return;
  this.cancelNoMoveTimer();

  var self = this;
  if (this.isGameTerminated()) return;
  if (this.moveInProgress) return;

  var beforeState = {
    grid: this.grid.serialize(),
    score: this.score,
    won: this.won,
    over: this.over,
    keepPlaying: this.keepPlaying
  };

  var cell, tile;
  var vector = this.getVector(direction);
  var traversals = this.buildTraversals(vector);
  var moved = false;

  this.prepareTiles();

  var moveLog = [];

  traversals.x.forEach(function (x) {
    traversals.y.forEach(function (y) {
      cell = { x: x, y: y };
      tile = self.grid.cellContent(cell);
      if (tile) {
        var from = { x: tile.x, y: tile.y };
        var positions = self.findFarthestPosition(cell, vector);
        var next = self.grid.cellContent(positions.next);

        if (next && next.value === tile.value && !next.mergedFrom) {
          var merged = new Tile(positions.next, tile.value * 2);
          merged.mergedFrom = [tile, next];

          self.grid.insertTile(merged);
          self.grid.removeTile(tile);
          tile.updatePosition(positions.next);
          self.score += merged.value;
          if (merged.value === 2048) self.won = true;

          var to = { x: merged.x, y: merged.y };
          moveLog.push({
            from: from,
            to: to,
            value: tile.value,
            direction: direction,
            distance: Math.abs(to.x - from.x) + Math.abs(to.y - from.y),
            merged: true
          });
          var nextFrom = { x: next.x, y: next.y };
          moveLog.push({
            from: nextFrom,
            to: to,
            value: next.value,
            direction: direction,
            distance: Math.abs(to.x - nextFrom.x) + Math.abs(to.y - nextFrom.y),
            merged: true
          });
        } else {
          self.moveTile(tile, positions.farthest);
          var to = { x: tile.x, y: tile.y };
          if (from.x !== to.x || from.y !== to.y) {
            moveLog.push({
              from: from,
              to: to,
              value: tile.value,
              direction: direction,
              distance: Math.abs(to.x - from.x) + Math.abs(to.y - from.y),
              merged: false
            });
          }
        }

        if (!self.positionsEqual(cell, tile)) {
          moved = true;
        }
      }
    });
  });

  if (moved) {
    beforeState.moveLog = moveLog;
    this.history.push(beforeState);
    this.moveInProgress = true;
    this.addRandomTile();

    if (!this.movesAvailable()) {
      this.over = true;
    }

    this.actuate();
    this.moveInProgressTimer = setTimeout(function () {
      self.moveInProgress = false;
      self.moveInProgressTimer = null;
      self.startNoMoveTimer();
    }, this.moveAnimationTime);
  } else {
    this.startNoMoveTimer();
  }
};

// ---------- 重启游戏（强制重置，并清除消息） ----------
GameManager.prototype.restart = function () {
  // 清除存储
  this.storageManager.clearGameState();

  // 清空棋盘 DOM
  var container = document.querySelector('.tile-container');
  if (container) container.innerHTML = '';

  // 重置所有内部状态
  this.grid = new Grid(this.size);
  this.score = 0;
  this.over = false;
  this.won = false;
  this.keepPlaying = false;
  this.history = [];
  this.moveInProgress = false;
  if (this.moveInProgressTimer) {
    clearTimeout(this.moveInProgressTimer);
    this.moveInProgressTimer = null;
  }
  this.cancelNoMoveTimer();
  if (this.advancedMode) this.exitAdvancedMode();

  // 重置计时器并启动
  this.resetTimer();
  this.startTimer();

  // 生成初始方块
  this.addStartTiles();

  // 强制清除游戏结束/胜利蒙层
  this.actuator.clearMessage();

  // 更新界面（刷新棋盘和分数）
  this.actuate();

  // 重新启动高级模式入口计时器
  this.startNoMoveTimer();
};

GameManager.prototype.keepPlaying = function () {
  this.keepPlaying = true;
  this.actuator.continueGame();
};

GameManager.prototype.isGameTerminated = function () {
  return this.over || (this.won && !this.keepPlaying);
};

GameManager.prototype.setup = function () {
  this.moveInProgress = false;
  if (this.moveInProgressTimer) {
    clearTimeout(this.moveInProgressTimer);
    this.moveInProgressTimer = null;
  }
  this.history = [];
  this.cancelNoMoveTimer();
  this.stopTimer();
  if (this.advancedMode) this.exitAdvancedMode();

  var previousState = this.storageManager.getGameState();
  if (previousState) {
    this.grid = new Grid(previousState.grid.size, previousState.grid.cells);
    this.score = previousState.score;
    this.over = previousState.over;
    this.won = previousState.won;
    this.keepPlaying = previousState.keepPlaying;
    this.elapsedSeconds = previousState.timerSeconds || 0;
    this.updateTimerDisplay();
    if (!this.isGameTerminated() && !this.advancedMode) {
      this.startTimer();
    } else {
      this.stopTimer();
    }
  } else {
    this.grid = new Grid(this.size);
    this.score = 0;
    this.over = false;
    this.won = false;
    this.keepPlaying = false;
    this.addStartTiles();
    this.resetTimer();
    this.startTimer();
  }
  this.actuate();
  this.startNoMoveTimer();
};

GameManager.prototype.addStartTiles = function () {
  for (var i = 0; i < this.startTiles; i++) {
    this.addRandomTile();
  }
};

GameManager.prototype.addRandomTile = function () {
  if (this.grid.cellsAvailable()) {
    var value = Math.random() < 0.9 ? 2 : 4;
    var tile = new Tile(this.grid.randomAvailableCell(), value);
    this.grid.insertTile(tile);
  }
};

GameManager.prototype.prepareTiles = function () {
  this.grid.eachCell(function (x, y, tile) {
    if (tile) {
      tile.mergedFrom = null;
      tile.savePosition();
    }
  });
};

GameManager.prototype.moveTile = function (tile, cell) {
  this.grid.cells[tile.x][tile.y] = null;
  this.grid.cells[cell.x][cell.y] = tile;
  tile.updatePosition(cell);
};

GameManager.prototype.getVector = function (direction) {
  var map = {
    0: { x: 0, y: -1 },
    1: { x: 1, y: 0 },
    2: { x: 0, y: 1 },
    3: { x: -1, y: 0 }
  };
  return map[direction];
};

GameManager.prototype.buildTraversals = function (vector) {
  var traversals = { x: [], y: [] };
  for (var pos = 0; pos < this.size; pos++) {
    traversals.x.push(pos);
    traversals.y.push(pos);
  }
  if (vector.x === 1) traversals.x = traversals.x.reverse();
  if (vector.y === 1) traversals.y = traversals.y.reverse();
  return traversals;
};

GameManager.prototype.findFarthestPosition = function (cell, vector) {
  var previous;
  do {
    previous = cell;
    cell = { x: previous.x + vector.x, y: previous.y + vector.y };
  } while (this.grid.withinBounds(cell) && this.grid.cellAvailable(cell));
  return { farthest: previous, next: cell };
};

GameManager.prototype.movesAvailable = function () {
  return this.grid.cellsAvailable() || this.tileMatchesAvailable();
};

GameManager.prototype.tileMatchesAvailable = function () {
  var self = this;
  var tile;
  for (var x = 0; x < this.size; x++) {
    for (var y = 0; y < this.size; y++) {
      tile = this.grid.cellContent({ x: x, y: y });
      if (tile) {
        for (var direction = 0; direction < 4; direction++) {
          var vector = self.getVector(direction);
          var cell = { x: x + vector.x, y: y + vector.y };
          var other = self.grid.cellContent(cell);
          if (other && other.value === tile.value) return true;
        }
      }
    }
  }
  return false;
};

GameManager.prototype.positionsEqual = function (first, second) {
  return first.x === second.x && first.y === second.y;
};

// ---------- 撤销（允许在游戏结束后撤销） ----------
GameManager.prototype.undo = function () {
  if (this.moveInProgress) return;
  if (this.history.length === 0) return;

  var previous = this.history.pop();
  var currentGrid = this.grid;
  var oldGrid = new Grid(this.size, previous.grid.cells);

  var self = this;
  this.actuator.animateUndo(oldGrid, currentGrid, previous.moveLog).then(function () {
    self.grid = oldGrid;
    self.score = previous.score;
    self.won = previous.won;
    self.over = previous.over;
    self.keepPlaying = previous.keepPlaying;

    self.actuator.updateScore(self.score);
    self.actuator.updateBestScore(self.storageManager.getBestScore());

    // 清除消息，防止残留
    self.actuator.clearMessage();

    if (self.over) {
      self.storageManager.clearGameState();
    } else {
      self.storageManager.setGameState(self.serialize());
    }

    if (self.advancedMode) {
      requestAnimationFrame(function() { self.addTileControls(); });
    }
  });
};