// 기준: Figma S05 장치 점검(18:2333) · S05-E 권한 거부(18:4013) · 기획 메모 S05(생성 실패 시 재시도, 권한 거부 시 안내 모달)
//   · 기획 메모 S05-E · Swagger 5.2 면접 조회(2초마다) · 5.3 면접 플랜 재생성 · 5.4 면접 시작
// 체크 줄 · 문구 · 소리 크기 · 녹음 · 모델 받기 재시도 · 5.4 응답별 처리는 단위 · 컴포넌트 테스트가,
// 여기서는 page의 주소 분기를 본다.
// 카메라 · 마이크는 Chromium의 가짜 장치를 쓰고 권한은 브라우저 컨텍스트로 준다. 기본 headless shell은 카메라 · 마이크를
// 지원하지 않아(NotSupportedError) 이 파일만 새 headless 모드(channel: "chromium")로 돌린다.

import { routeInterviewerModel } from "./mocks/interviewer-model";
import { PROBLEM, SESSION, SESSION_PLAN } from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

const S05 = `/practice/devices?sessionId=${SESSION.id}`;

test.use({
  channel: "chromium",
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  },
  permissions: ["camera", "microphone"],
});

test.beforeEach(async ({ signIn, page }) => {
  await signIn();
  // S05는 면접관 3D 모델을 다 받아야 질문 준비가 끝난다. 빈 모델로 바로 받게 한다.
  await routeInterviewerModel(page, "empty");
});

test.describe("S05 · 장치 점검", () => {
  test.describe("주소", () => {
    test.describe("화면 표시", () => {
      test("채팅 면접이면 장치 점검 없이 면접 화면으로 보낸다", async ({ page, msw }) => {
        msw.use(
          http.get(api("/interview-sessions/:sessionId"), () =>
            HttpResponse.json({ ...SESSION_PLAN.READY, mode: "CHAT" }),
          ),
        );
        await page.goto(S05);

        await expect(page).toHaveURL(`/interview/${SESSION.id}`);
      });
    });

    test.describe("입력 검증", () => {
      test("주소의 sessionId 형식이 틀리면 S03로 보낸다", async ({ page }) => {
        await page.goto("/practice/devices?sessionId=abc");

        await expect(page).toHaveURL("/practice");
      });
    });

    test.describe("오류 처리", () => {
      test("면접이 없으면(5.2 404 SESSION_NOT_FOUND) S03로 보낸다", async ({ page, msw }) => {
        msw.use(
          http.get(api("/interview-sessions/:sessionId"), () =>
            problemResponse(PROBLEM.SESSION_NOT_FOUND),
          ),
        );
        await page.goto(S05);

        await expect(page).toHaveURL("/practice");
      });
    });
  });
});
