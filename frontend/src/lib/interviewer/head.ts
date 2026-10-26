import { Euler, PropertyBinding, Quaternion, type Object3D } from "three";

/** 로더가 정리한 뼈대 이름으로 찾고, 기본 자세의 회전에 작은 동작을 반영한다. */
export function createHeadControl(root: Object3D, name?: string) {
  const head = name ? root.getObjectByName(PropertyBinding.sanitizeNodeName(name)) : undefined;
  if (name && !head) throw new Error("면접관 머리 뼈대를 찾을 수 없다");
  const rest = head?.quaternion.clone();
  const rotation = new Quaternion();
  const euler = new Euler();
  return (pitch: number, roll: number) => {
    if (!head || !rest) return;
    euler.set(pitch, 0, roll);
    head.quaternion.copy(rest).multiply(rotation.setFromEuler(euler));
  };
}
