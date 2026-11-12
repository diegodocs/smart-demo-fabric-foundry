const FRAME_INTERVAL_MS = 1000 / 30;

export function startPharmaRenderLoop(render, onResume) {
  let raf = null;
  let lastFrame = null;
  let nextFrame = null;
  let visible = !document.hidden;
  let disposed = false;

  function reset() {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
    lastFrame = nextFrame = null;
  }

  function frame(time) {
    raf = null;
    if (disposed || document.hidden) {
      visible = false;
      reset();
      return;
    }
    if (nextFrame === null || time + 0.001 >= nextFrame) {
      const dt = lastFrame === null ? 0 : Math.max(0, (time - lastFrame) / 1000);
      nextFrame = nextFrame === null ? time + FRAME_INTERVAL_MS
        : nextFrame + (Math.floor(Math.max(0, time - nextFrame) / FRAME_INTERVAL_MS) + 1) * FRAME_INTERVAL_MS;
      lastFrame = time;
      render(dt, time);
    }
    if (!disposed && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function visibilityChanged() {
    if (document.hidden) {
      visible = false;
      reset();
    } else if (!visible && !disposed) {
      visible = true;
      onResume();
      raf = requestAnimationFrame(frame);
    }
  }

  document.addEventListener('visibilitychange', visibilityChanged);
  if (visible) raf = requestAnimationFrame(frame);

  return () => {
    disposed = true;
    reset();
    document.removeEventListener('visibilitychange', visibilityChanged);
  };
}

export function updatePharmaControls(controls, dt) {
  const dampingFactor = controls.dampingFactor;
  controls.dampingFactor = 1 - (1 - dampingFactor) ** (dt * 60);
  controls.update(dt);
  controls.dampingFactor = dampingFactor;
}
