import { useEffect, useRef, useState } from "react";
import { DEX_OFF, getState, openPad, subscribe } from "../../lib/dex";
import { PAD_CAMERA_HOME, pinchPadCamera, subscribePad, type PadSample } from "../../lib/dex-pad";

export function useDexPad(active: boolean, allowed: boolean, commit: (points: PadSample[]) => void) {
  const [state, setState] = useState(DEX_OFF);
  const [error, setError] = useState(false);
  const [camera, setCamera] = useState(PAD_CAMERA_HOME);
  const [preview, setPreview] = useState<PadSample[]>([]);
  const cameraRef = useRef(PAD_CAMERA_HOME);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    let mounted = true;
    const off = subscribe(setState);
    void getState().then(state => { if (mounted) setState(state); }).catch(() => {});
    return () => { mounted = false; off(); };
  }, []);
  const onTv = state.mode === "dual" && state.tvDisplayId != null && state.mainDisplayId === state.tvDisplayId;
  const enabled = onTv && active && state.padOpen;
  useEffect(() => {
    function reset() {
      cameraRef.current = PAD_CAMERA_HOME;
      setCamera(PAD_CAMERA_HOME);
      setPreview([]);
    }
    if (!enabled) { reset(); return; }
    return subscribePad(event => {
      if (event.type === "reset") { reset(); return; }
      if (event.type === "cancel") { setPreview([]); return; }
      if (!allowed) return;
      if (event.type === "pinch") {
        const next = pinchPadCamera(cameraRef.current, event.from, event.to, event.scale);
        cameraRef.current = next;
        setCamera(next);
      } else if (event.type === "ink") {
        if (!event.done) { setPreview(event.points); return; }
        setPreview([]);
        const { x, y, scale } = cameraRef.current;
        commitRef.current(event.points.map(point => ({ x: (point.x - x) / scale, y: (point.y - y) / scale, t: point.t })));
      }
    });
  }, [enabled, allowed]);
  return {
    camera, preview, error, showOpen: onTv && !state.padOpen,
    launch: () => {
      setError(false);
      void openPad().then(ok => { if (!ok) setError(true); }).catch(() => setError(true));
    },
  };
}
