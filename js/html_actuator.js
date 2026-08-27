function HTMLActuator() {
  this.tileContainer    = document.querySelector(".tile-container");
  this.scoreContainer   = document.querySelector(".score-container");
  this.bestScoreElement = document.getElementById("best-score-number");
  this.messageContainer = document.querySelector(".game-message");
  this.score = 0;
}

HTMLActuator.prototype.actuate = function (grid, metadata) {
  var self = this;
  var noAnimation = metadata.noAnimation || false;
  window.requestAnimationFrame(function () {
    self.clearContainer(self.tileContainer);
    grid.cells.forEach(function (column) {
      column.forEach(function (cell) {
        if (cell) self.addTile(cell, noAnimation, false);
      });
    });
    self.updateScore(metadata.score);
    self.updateBestScore(metadata.bestScore);
    if (metadata.terminated) {
      metadata.over ? self.message(false) : self.message(true);
    }
  });
};

HTMLActuator.prototype.addTile = function (tile, noAnimation, isUndo) {
  var self = this;
  var wrapper = document.createElement("div");
  var inner   = document.createElement("div");

  var initialPosition = tile.previousPosition || { x: tile.x, y: tile.y };
  var positionClass = this.positionClass(initialPosition);

  var classes = ["tile", "tile-" + tile.value, positionClass];
  if (tile.value > 2048) classes.push("tile-super");

  wrapper.setAttribute('data-x', tile.x);
  wrapper.setAttribute('data-y', tile.y);
  this.applyClasses(wrapper, classes);

  inner.classList.add("tile-inner");
  inner.textContent = tile.value;

  inner.style.display = 'flex';
  inner.style.alignItems = 'center';
  inner.style.justifyContent = 'center';
  inner.style.width = '100%';
  inner.style.height = '100%';
  inner.style.lineHeight = 'normal';

  var isMobile = window.innerWidth < 520;
  var baseSize = isMobile ? 32 : 55;
  var len = tile.value.toString().length;
  var fontSize = Math.max(12, baseSize - (len - 1) * 8);
  inner.style.fontSize = fontSize + 'px';

  if (!noAnimation) {
    if (!isUndo && !tile.previousPosition && !tile.mergedFrom) {
      classes.push("tile-new");
      this.applyClasses(wrapper, classes);
    }
    if (tile.previousPosition) {
      window.requestAnimationFrame(function () {
        var finalClass = self.positionClass({ x: tile.x, y: tile.y });
        classes[2] = finalClass;
        self.applyClasses(wrapper, classes);
      });
    }
    if (!isUndo && tile.mergedFrom) {
      classes.push("tile-merged");
      this.applyClasses(wrapper, classes);
      tile.mergedFrom.forEach(function (merged) {
        self.addTile(merged, noAnimation, isUndo);
      });
    }
  } else {
    var finalClass = this.positionClass({ x: tile.x, y: tile.y });
    classes[2] = finalClass;
    this.applyClasses(wrapper, classes);
    wrapper.style.transition = 'none';
    wrapper.offsetHeight;
    wrapper.style.transition = '';
  }

  wrapper.appendChild(inner);
  this.tileContainer.appendChild(wrapper);
};

HTMLActuator.prototype.animateUndo = function (oldGrid, currentGrid, moveLog) {
  var self = this;
  return new Promise(function (resolve) {
    if (moveLog && moveLog.length > 0) {
      self.clearContainer(self.tileContainer);
      var oldTiles = [];
      oldGrid.cells.forEach(function (col, x) {
        col.forEach(function (cell, y) {
          if (cell) oldTiles.push(cell);
        });
      });
      oldTiles.forEach(function (tile) {
        var matched = false;
        for (var i = 0; i < moveLog.length; i++) {
          var log = moveLog[i];
          if (log.from.x === tile.x && log.from.y === tile.y && log.value === tile.value) {
            tile.previousPosition = { x: log.to.x, y: log.to.y };
            matched = true;
            break;
          }
        }
        if (!matched) tile.previousPosition = null;
      });
      oldTiles.forEach(function (tile) {
        self.addTile(tile, false, true);
      });
      setTimeout(resolve, 20);
    } else {
      var currentTiles = [];
      currentGrid.cells.forEach(function (col, x) {
        col.forEach(function (cell, y) {
          if (cell) currentTiles.push({ x: x, y: y, value: cell.value, matched: false });
        });
      });
      var oldTiles = [];
      oldGrid.cells.forEach(function (col, x) {
        col.forEach(function (cell, y) {
          if (cell) oldTiles.push({ x: x, y: y, value: cell.value, tile: cell });
        });
      });
      oldTiles.forEach(function (old) {
        var matched = false;
        for (var i = 0; i < currentTiles.length; i++) {
          var cur = currentTiles[i];
          if (!cur.matched && cur.value === old.value) {
            cur.matched = true;
            matched = true;
            if (cur.x !== old.x || cur.y !== old.y) {
              old.tile.previousPosition = { x: cur.x, y: cur.y };
            } else {
              old.tile.previousPosition = null;
            }
            break;
          }
        }
        if (!matched) old.tile.previousPosition = null;
      });
      var removePromises = [];
      currentTiles.forEach(function (cur) {
        if (!cur.matched) {
          var selector = '.tile[data-x="' + cur.x + '"][data-y="' + cur.y + '"]';
          var tileEl = self.tileContainer.querySelector(selector);
          if (tileEl) {
            tileEl.classList.add('tile-removing');
            var promise = new Promise(function (res) {
              tileEl.addEventListener('animationend', function onEnd() {
                tileEl.removeEventListener('animationend', onEnd);
                res();
              });
              setTimeout(res, 250);
            });
            removePromises.push(promise);
          }
        }
      });
      Promise.all(removePromises).then(function () {
        self.clearContainer(self.tileContainer);
        oldTiles.forEach(function (old) {
          self.addTile(old.tile, false, true);
        });
        resolve();
      });
    }
  });
};

HTMLActuator.prototype.continueGame = function () {
  this.clearMessage();
};

HTMLActuator.prototype.clearContainer = function (container) {
  while (container.firstChild) container.removeChild(container.firstChild);
};

HTMLActuator.prototype.applyClasses = function (element, classes) {
  element.setAttribute("class", classes.join(" "));
};

HTMLActuator.prototype.normalizePosition = function (position) {
  return { x: position.x + 1, y: position.y + 1 };
};

HTMLActuator.prototype.positionClass = function (position) {
  position = this.normalizePosition(position);
  return "tile-position-" + position.x + "-" + position.y;
};

HTMLActuator.prototype.updateScore = function (score) {
  this.clearContainer(this.scoreContainer);
  var difference = score - this.score;
  this.score = score;
  this.scoreContainer.textContent = this.score;
  if (difference > 0) {
    var addition = document.createElement("div");
    addition.classList.add("score-addition");
    addition.textContent = "+" + difference;
    this.scoreContainer.appendChild(addition);
  }
};

HTMLActuator.prototype.updateBestScore = function (bestScore) {
  // 只更新最高分数字，不影响标签和按钮
  if (this.bestScoreElement) {
    this.bestScoreElement.textContent = bestScore;
  }
};

HTMLActuator.prototype.message = function (won) {
  var type    = won ? "game-won" : "game-over";
  var message = won ? "你赢了！" : "游戏结束！";
  this.messageContainer.classList.add(type);
  this.messageContainer.getElementsByTagName("p")[0].textContent = message;
};

HTMLActuator.prototype.clearMessage = function () {
  this.messageContainer.classList.remove("game-won");
  this.messageContainer.classList.remove("game-over");
};