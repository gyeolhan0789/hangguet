# 오리 모델

승인된 `penguin_talking.blend`에서 내보낸 오리입니다. 기존 면접관과 같은 자산 위치에 보관합니다.

- 모델 URL: `/interview/duck/interviewer.glb`
- 15개 부위, 눈 셰이프 키 `Smile` · `Angry` · `Blink`
- 단위: 미터. glTF 표준 Y-up, 정면 +Z, 발 기준 원점.
- 색은 승인된 단색 영역을 조명 없이 베이크한 텍스처로 GLB 안에 포함했습니다. 외부 텍스처는 필요 없습니다.
- 다른 면접관처럼 텍스처는 WebP(품질 90)로 바꾸고 형상은 meshopt로 압축했습니다(`@gltf-transform/cli` `webp` → `meshopt`, 7.2MB → 2.2MB). 불러올 때 `MeshoptDecoder`가 필요합니다. 압축하면서 메시가 있는 부위에 양자화 위치 · 배율이 들어가고 `Head` 메시는 이름 없는 자식 노드로 옮겨지지만, 동작 클립이 움직이는 `Duck_*` 부위와 눈 셰이프 키는 그대로입니다.
- 원본 메시의 좌표와 디테일을 보존했습니다. 원본 텍스처를 재사용하지 않았습니다.

## 동작

| 클립               | 동작                                                           |
| ------------------ | -------------------------------------------------------------- |
| `Duck_Folded_Idle` | 승인된 날개 접은 기본 자세                                     |
| `Duck_Nod_Double`  | 두 번 끄덕임                                                   |
| `Duck_Talk`        | 부리 여닫기, 몸통과 머리 들썩임, 구절 사이 쉼과 깜빡임         |
| `Duck_Surprise`    | 날개 펴기, 고개 위로 갸우뚱, 부리 살짝 벌리기. 승인된 2배 속도 |
| `Duck_Blink`       | 기본 눈 깜빡임                                                 |

기존에 설치된 three.js 0.186.1의 `GLTFLoader`와 `AnimationMixer`로 사용할 수 있습니다.

```ts
import { AnimationClip, AnimationMixer } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const model = await new GLTFLoader().loadAsync("/interview/duck/interviewer.glb");
const mixer = new AnimationMixer(model.scene);
const talk = AnimationClip.findByName(model.animations, "Duck_Talk");
if (talk) mixer.clipAction(talk).play();
// 렌더 루프에서 mixer.update(deltaSeconds).
```

표정 메시의 이름은 기존 FE 규칙에 맞춘 `WEB_Eye_L`, `WEB_Eye_R`,
`WEB_Eye_L_Catchlight`, `WEB_Eye_R_Catchlight`입니다. `face-rules.json`은 기존
`FaceRules` 형식을 따릅니다. 웃음은 Joy/Fun/Smile이 공유합니다. 화남과 웃음에서는
이미 감긴 선 형태의 눈을 쓰므로 Blink를 섞지 않습니다.

말하기는 사람의 A/I/U/E/O 입 모양을 쓰지 않습니다. 부리를 독립적으로 제어하려면
`Duck_Beak_Lower`의 로컬 X 회전을 0~5.5도, `Duck_Beak_Upper`는 그 반대 방향으로
0~0.66도 적용합니다. 제어하지 않는 쪽은 `Duck_Talk` 클립을 그대로 재생하면 됩니다.

현재 면접의 DEVIL/COFFEE_CHAT 선택 항목과 동작 연결은 변경하지 않았습니다.
이 모델의 동작은 기존 면접관의 read/rest/tilt 구간과 다르므로, 모든 클립을 한 개로
합치지 말고 이름으로 선택해서 재생해야 합니다. 슬픔 눈은 아직 제작하지 않았습니다.

## 별도 테스트 화면

저장소 루트에서 `node tools/duck-preview/server.mjs`를 실행한 뒤
`http://127.0.0.1:4173`을 엽니다. 이 화면은 위 FE 모델 파일을 직접 불러옵니다.
표정 3종, 동작 4종, 깜빡임, 속도, 반복, 재생 위치와 보기 방향을 테스트할 수 있습니다.

검증: `node tools/duck-preview/verify-model.mjs`.
출처: Blender 5.2 glTF/UV/색상 베이크 공식 문서, three.js 0.186.1 공식 API,
사용자가 승인한 Blender 표정·끄덕임·놀람·말하기 결과(2026-11-04).
