// Apply initial states immediately to prevent flashing
(function() {
  try {
    // Apply window visibility immediately
    const savedWindows = localStorage.getItem('osrs-selected-windows');
    if (savedWindows) {
      const selectedWindows = JSON.parse(savedWindows);
      const allWindows = document.querySelectorAll('.window[data-window-id]');
      allWindows.forEach(function(windowElement) {
        const windowId = windowElement.dataset.windowId;
        if (selectedWindows.indexOf(windowId) === -1) {
          windowElement.classList.add('hidden');
        }
      });
    }

    // Apply minimized states immediately
    const savedStates = JSON.parse(localStorage.getItem('osrs-minimized-windows') || '{}');
    document.querySelectorAll('.window').forEach(function(windowElement) {
      const titleText = windowElement.querySelector('.title-bar-text');
      if (titleText) {
        const windowId = titleText.textContent.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        if (savedStates[windowId]) {
          windowElement.classList.add('minimized');
        }

        const windowBody = windowElement.querySelector('.window-body');
        const minimizeButton = windowElement.querySelector('.title-bar-controls button[onclick^="toggleWindow"]');
        if (windowBody && minimizeButton) {
          const bodyId = 'window-body-' + windowId;
          const isMinimized = windowElement.classList.contains('minimized');
          windowBody.id = bodyId;
          minimizeButton.setAttribute('aria-controls', bodyId);
          minimizeButton.setAttribute('aria-expanded', String(!isMinimized));
          minimizeButton.setAttribute('aria-label', isMinimized ? 'Restore' : 'Minimize');
          minimizeButton.setAttribute('title', (isMinimized ? 'Restore ' : 'Minimize ') + titleText.textContent.trim());
        }
      }
    });
  } catch (e) {
    // If localStorage fails, continue normally
    console.warn('Failed to apply initial states:', e);
  }
})();
