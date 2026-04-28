// Screen router. Toggles `.active` on `<section data-screen="...">` elements.

let currentScreen = 'boot';

export function showScreen(name) {
  document.querySelectorAll('#screen > section').forEach(s => {
    s.classList.toggle('active', s.dataset.screen === name);
  });
  currentScreen = name;
}

export function activeScreen() {
  return currentScreen;
}
