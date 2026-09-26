// Render layers. Objects on NO_REFLECT are skipped by the planar reflection pass.
export const LAYERS = { DEFAULT: 0, NO_REFLECT: 2 };

export function noReflect(obj) {
  obj.layers.set(LAYERS.NO_REFLECT);
  return obj;
}
