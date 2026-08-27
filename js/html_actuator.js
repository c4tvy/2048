function HTMLActuator() {
  this.tileContainer    = document.querySelector(".tile-container");
  this.scoreContainer   = document.querySelector(".score-container");
  this.bestContainer    = document.querySelector(".best-container");
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

  // 确定初始位置（如果是移动动画，则使用 previousPosition，否则用当前位置）
  var initialPosition = tile.previousPosition || { x: tile.x, y: tile.y };
  var positionClass = this.positionClass(initialPosition);

  var classes = ["tile", "tile-" + tile.value, positionClass];
  if (tile.value > 2048) classes.push("tile-super");

  wrapper.setAttribute('data-x', tile.x);
  wrapper.setAttribute('data-y', tile.y);
  this.applyClasses(wrapper, classes);

  inner.classList.add("tile-inner");
  inner.textContent = tile.value;

  // ---------- 动画逻辑 ----------
  if (!noAnimation) {
    // 1. 新方块出现动画（仅当不是撤销操作，且没有 previousPosition 和 mergedFrom）
    if (!isUndo && !tile.previousPosition && !tile.mergedFrom) {
      classes.push("tile-new");
      this.applyClasses(wrapper, classes);
    }
    // 2. 移动动画：如果存在 previousPosition，则在下一帧更新到最终位置
    if (tile.previousPosition) {
      // 先确保初始位置已渲染，再移动到最终位置
      window.requestAnimationFrame(function () {
        var finalClass = self.positionClass({ x: tile.x, y: tile.y });
        // 替换位置类（第三个元素是位置类）
        classes[2] = finalClass;
        self.applyClasses(wrapper, classes);
      });
    }
    // 3. 合并动画（仅当非撤销且有 mergedFrom）
    if (!isUndo && tile.mergedFrom) {
      classes.push("tile-merged");
      this.applyClasses(wrapper, classes);
      // 递归绘制合并源
      tile.mergedFrom.forEach(function (merged) {
        self.addTile(merged, noAnimation, isUndo);
      });
    }
  } else {
    // 无动画模式（高级模式）：直接设置最终位置，禁用过渡
    var finalClass = this.positionClass({ x: tile.x, y: tile.y });
    classes[2] = finalClass;
    this.applyClasses(wrapper, classes);
    wrapper.style.transition = 'none';
    // 强制重排
    wrapper.offsetHeight;
    wrapper.style.transition = '';
  }

  wrapper.appendChild(inner);
  this.tileContainer.appendChild(wrapper);
};

// ---------- 撤销动画 ----------
HTMLActuator.prototype.animateUndo = function (oldGrid, currentGrid, moveLog) {
  var self = this;
  return new Promise(function (resolve) {
    // 优先使用移动日志
    if (moveLog && moveLog.length > 0) {
      self.clearContainer(self.tileContainer);

      var oldTiles = [];
      oldGrid.cells.forEach(function (col, x) {
        col.forEach(function (cell, y) {
          if (cell) oldTiles.push(cell);
        });
      });

      // 为每个旧方块设置 previousPosition（反向移动）
      oldTiles.forEach(function (tile) {
        var matched = false;
        for (var i = 0; i < moveLog.length; i++) {
          var log = moveLog[i];
          // 匹配：位置和值都相同
          if (log.from.x === tile.x && log.from.y === tile.y && log.value === tile.value) {
            tile.previousPosition = { x: log.to.x, y: log.to.y };
            matched = true;
            break;
          }
        }
        if (!matched) tile.previousPosition = null;
      });

      // 重新绘制所有旧方块，标记为撤销（不添加出现/合并动画）
      oldTiles.forEach(function (tile) {
        // 注意：这里 noAnimation 传 false，但 isUndo 传 true，因此不会有新方块动画
        self.addTile(tile, false, true);
      });

      // 等待一帧，让浏览器完成布局和过渡
      setTimeout(resolve, 20);
    } else {
      // 回退到基于值匹配的通用方法（兼容旧存档）
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

      // 匹配旧方块到当前方块（相同值）
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

      // 标记未匹配的当前方块（即新生成的）进行消失动画
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
          self.addTile(old.tile, false, true); // 撤销标记，不加出现动画
        });
        resolve();
      });
    }
  });
};

// ---------- 辅助方法 ----------
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
  this.bestContainer.textContent = bestScore;
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