export function trackSceneHover(element, pick) {
  let position = null;

  const clear = () => {
    position = null;
    element.style.cursor = 'grab';
  };
  const move = (event) => {
    if (event.pointerType !== 'mouse') {
      clear();
      return;
    }
    position = { clientX: event.clientX, clientY: event.clientY };
  };
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerleave', clear);
  element.addEventListener('pointercancel', clear);

  return {
    current() {
      if (!position) return null;
      const rect = element.getBoundingClientRect();
      if (position.clientX < rect.left || position.clientX >= rect.right
        || position.clientY < rect.top || position.clientY >= rect.bottom) {
        clear();
        return null;
      }
      const id = pick(position) ?? null;
      element.style.cursor = id ? 'pointer' : 'grab';
      return id;
    },
    dispose() {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerleave', clear);
      element.removeEventListener('pointercancel', clear);
      clear();
    },
  };
}
