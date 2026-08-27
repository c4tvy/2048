// Wait till the browser is ready to render the game (avoids glitches)
window.requestAnimationFrame(function () {
  var storageKey = "theme";
  var themeToggle = document.querySelector(".theme-toggle-button");

  function applyTheme(theme) {
    var isDark = theme === "dark";
    document.body.classList.toggle("dark-mode", isDark);

    if (themeToggle) {
      themeToggle.textContent = isDark ? "浅色模式" : "深色模式";
      themeToggle.setAttribute("aria-pressed", String(isDark));
    }
  }

  var savedTheme = localStorage.getItem(storageKey);
  applyTheme(savedTheme === "dark" ? "dark" : "light");

  if (themeToggle) {
    function toggleTheme() {
      var nextTheme = document.body.classList.contains("dark-mode") ? "light" : "dark";
      applyTheme(nextTheme);
      localStorage.setItem(storageKey, nextTheme);
    }

    themeToggle.addEventListener("click", toggleTheme);
    themeToggle.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleTheme();
      }
    });
  }

  var gameManager = new GameManager(4, KeyboardInputManager, HTMLActuator, LocalStorageManager);
  // 监听撤销事件
  gameManager.inputManager.on("undo", gameManager.undo.bind(gameManager));
});