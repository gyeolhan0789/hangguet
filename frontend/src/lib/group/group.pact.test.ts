import { MatchersV3 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";

import {
  asMember,
  bearer,
  contract,
  oneOf,
  problem,
  providerPath,
  providerValue,
  shape,
} from "@/test/pact";
import type {
  GroupResponse,
  InviteResponse,
  JobCategory,
  ParticipantResponse,
  Persona,
} from "@/types/api";

import {
  createGroup,
  extendTurn,
  joinGroup,
  leaveGroup,
  saveAnswerDraft,
  setGroupReady,
  startGroup,
} from "./actions";
import { getGroup, getInvite } from "./queries";

// 기준: BE Swagger 10.1 ~ 10.9 그룹 면접 예시(그룹 7 · 내 면접 55 · 초대 코드 K7Q2ZP) · API 명세 10.10
const { like, eachLike } = MatchersV3;
/** 화면이 라벨로만 쓰는 enum(면접관 · 직군 이름). 값마다 다르게 그리지 않아 FE가 아는 값 중 하나인지만 본다 */
const PERSONAS: readonly Persona[] = ["DEVIL", "COFFEE_CHAT", "DUCK"];
const JOBS: readonly JobCategory[] = [
  "DEVELOPMENT",
  "DATA_AI",
  "DESIGN",
  "PLANNING",
  "MARKETING",
  "SALES",
  "MANAGEMENT_SUPPORT",
  "ETC",
];
const pact = contract();

const KEY = "3f2b8c1e-7d4a-4f6b-9a2e-1c5d8e7f9a01";
const idempotent = { ...bearer, "Idempotency-Key": KEY };
const groupPath = (path: string) =>
  providerPath(`/interview-groups/\${groupId}${path}`, `/interview-groups/7${path}`);
const missingGroup = "/api/v1/interview-groups/999999999";
const notFound = { code: "GROUP_NOT_FOUND" };
const invalidState = {
  detail: "지금은 할 수 없는 요청이에요.",
  code: "INVALID_GROUP_STATE",
} as const;
const createBody = {
  mode: "CHAT",
  persona: "COFFEE_CHAT",
  capacity: 2,
  jobCategory: "DEVELOPMENT",
} as const;

// 10.4를 받는 화면(대기실 · 그룹 면접방)이 읽는 필드만 둔다
type GroupView = Omit<GroupResponse, "jobCategoryMismatch" | "turn" | "room" | "participants">;
type MemberView = Omit<ParticipantResponse, "turnOrder" | "state">;
const host = {
  userId: 3,
  nickname: "면접왕",
  profileImageUrl: null,
  jobCategory: "DEVELOPMENT",
  sessionId: 55,
  planStatus: "GENERATING",
  ready: false,
} satisfies MemberView;
const waiting = {
  groupId: 7,
  status: "WAITING",
  mode: "CHAT",
  persona: "COFFEE_CHAT",
  jobCategory: "DEVELOPMENT",
  capacity: 2,
  inviteCode: "K7Q2ZP",
  hostUserId: 3,
  mySessionId: 55,
} satisfies GroupView;

describe("그룹 만들기 · 참가", () => {
  it("10.1 그룹을 만들면 대기실로 간다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("지원서")
      .uponReceiving("10.1 그룹 만들기")
      .withRequest("POST", "/api/v1/interview-groups", (b) =>
        b
          .headers(idempotent)
          .jsonBody({ ...createBody, applicationId: providerValue("applicationId", 10) }),
      )
      .willRespondWith(201, (b) => b.jsonBody(like({ groupId: 7 })))
      .executeTest(
        asMember(() =>
          expect(createGroup({ ...createBody, applicationId: 10 }, KEY)).rejects.toThrow(
            "REDIRECT /groups/7",
          ),
        ),
      ));

  it("10.1 없는 지원서면 연습 시작으로 돌아간다(404 APPLICATION_NOT_FOUND)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("10.1 없는 지원서로 그룹 만들기")
      .withRequest("POST", "/api/v1/interview-groups", (b) =>
        b.headers(idempotent).jsonBody({ ...createBody, applicationId: 999999999 }),
      )
      .willRespondWith(404, (b) => problem(b, { code: "APPLICATION_NOT_FOUND" }))
      .executeTest(
        asMember(() =>
          expect(createGroup({ ...createBody, applicationId: 999999999 }, KEY)).rejects.toThrow(
            "REDIRECT /practice",
          ),
        ),
      ));

  it("10.1 이미 그룹에 있으면 서버 문구를 보이고 멱등 키를 새로 만들게 한다(409 ALREADY_IN_GROUP)", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("그룹", { stage: "WAITING", mode: "CHAT" })
      .uponReceiving("10.1 그룹에 있는 회원이 그룹 만들기")
      .withRequest("POST", "/api/v1/interview-groups", (b) =>
        b
          .headers(idempotent)
          .jsonBody({ ...createBody, applicationId: providerValue("applicationId", 10) }),
      )
      .willRespondWith(409, (b) =>
        problem(
          b,
          { detail: "이미 참가 중인 그룹 면접이 있어요.", code: "ALREADY_IN_GROUP" },
          { generic: true },
        ),
      )
      .executeTest(
        asMember(async () =>
          expect(await createGroup({ ...createBody, applicationId: 10 }, KEY)).toEqual({
            formError: "이미 참가 중인 그룹 면접이 있어요.",
            keySpent: true,
          }),
        ),
      ));

  it("10.2 초대 코드로 그룹을 확인한다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("다른 회원의 그룹", { full: false })
      .uponReceiving("10.2 초대 확인")
      .withRequest(
        "GET",
        providerPath("/interview-groups/invites/${inviteCode}", "/interview-groups/invites/K7Q2ZP"),
        (b) => b.headers(bearer),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody({
          ...shape({
            hostNickname: "면접왕",
            mode: "CHAT",
            capacity: 2,
            participantCount: 1,
          } satisfies Omit<InviteResponse, "groupId" | "persona" | "jobCategory">),
          persona: oneOf(PERSONAS, "COFFEE_CHAT"),
          jobCategory: oneOf(JOBS, "DEVELOPMENT"),
        }),
      )
      .executeTest(
        asMember(async () =>
          expect(await getInvite("K7Q2ZP")).toMatchObject({ jobCategory: "DEVELOPMENT" }),
        ),
      ));

  it("10.2 들어갈 수 없는 코드면 null(404 GROUP_NOT_FOUND)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("10.2 없는 초대 코드 확인")
      // 0은 초대 코드에 쓰지 않는 글자라 어떤 그룹과도 겹치지 않는다
      .withRequest("GET", "/api/v1/interview-groups/invites/000000", (b) => b.headers(bearer))
      .willRespondWith(404, (b) => problem(b, notFound))
      .executeTest(asMember(async () => expect(await getInvite("000000")).toBeNull())));

  it("10.3 초대 코드로 참가하면 대기실로 간다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("지원서")
      .given("다른 회원의 그룹", { full: false })
      .uponReceiving("10.3 그룹 참가")
      .withRequest("POST", "/api/v1/interview-groups/join", (b) =>
        b.headers(idempotent).jsonBody({
          inviteCode: providerValue("inviteCode", "K7Q2ZP"),
          applicationId: providerValue("applicationId", 10),
          jobCategory: "DEVELOPMENT",
        }),
      )
      .willRespondWith(201, (b) => b.jsonBody(like({ groupId: 7 })))
      .executeTest(
        asMember(() =>
          expect(
            joinGroup({ inviteCode: "K7Q2ZP", applicationId: 10, jobCategory: "DEVELOPMENT" }, KEY),
          ).rejects.toThrow("REDIRECT /groups/7"),
        ),
      ));

  it("10.3 자리가 찼으면 서버 문구를 보이고 멱등 키를 새로 만들게 한다(409 GROUP_FULL)", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("지원서")
      .given("다른 회원의 그룹", { full: true })
      .uponReceiving("10.3 자리가 찬 그룹 참가")
      .withRequest("POST", "/api/v1/interview-groups/join", (b) =>
        b.headers(idempotent).jsonBody({
          inviteCode: providerValue("inviteCode", "K7Q2ZP"),
          applicationId: providerValue("applicationId", 10),
          jobCategory: "DEVELOPMENT",
        }),
      )
      .willRespondWith(409, (b) =>
        problem(b, { detail: "자리가 다 찼어요.", code: "GROUP_FULL" }, { generic: true }),
      )
      .executeTest(
        asMember(async () =>
          expect(
            await joinGroup(
              { inviteCode: "K7Q2ZP", applicationId: 10, jobCategory: "DEVELOPMENT" },
              KEY,
            ),
          ).toEqual({ formError: "자리가 다 찼어요.", keySpent: true }),
        ),
      ));
});

describe("대기실", () => {
  it("10.4 대기 중인 그룹을 조회한다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("그룹", { stage: "WAITING", mode: "CHAT" })
      .uponReceiving("10.4 대기 중인 그룹 조회")
      .withRequest("GET", groupPath(""), (b) => b.headers(bearer))
      .willRespondWith(200, (b) =>
        b.jsonBody({
          ...shape(waiting, "status", "mode", "capacity"),
          persona: oneOf(PERSONAS, waiting.persona),
          jobCategory: oneOf(JOBS, waiting.jobCategory),
          participants: eachLike({
            ...shape(host, "planStatus", "ready"),
            jobCategory: oneOf(JOBS, host.jobCategory),
          }),
        }),
      )
      .executeTest(
        asMember(async () =>
          expect(await getGroup(7)).toEqual({ ...waiting, participants: [host] }),
        ),
      ));

  it("10.4 시작한 그룹을 조회한다(면접방이 쓰는 참가자 닉네임 · 면접방 정보를 받기 전 차례)", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("그룹", { stage: "IN_PROGRESS", mode: "CHAT" })
      .uponReceiving("10.4 시작한 그룹 조회")
      .withRequest("GET", groupPath(""), (b) => b.headers(bearer))
      .willRespondWith(200, (b) =>
        b.jsonBody({
          ...shape({ status: "IN_PROGRESS", mySessionId: 55 }, "status"),
          participants: eachLike(shape({ sessionId: 55, nickname: "면접왕" })),
          // 면접방 정보(10.11)를 받기 전에만 그대로 쓴다. 모양만 본다
          turn: {
            ...shape({
              turnVersion: 1,
              serverTime: "2026-11-04T14:03:00.120+09:00",
              groupStatus: "IN_PROGRESS",
              round: 1,
              phase: "ASKING",
            }),
            turn: like({
              sessionId: 55,
              seq: 1,
              kind: "COMMON",
              baseIndex: 1,
              announce: "FULL",
              deadlineAt: null,
              extended: false,
              followupsLeft: 2,
            }),
            participants: eachLike(
              like({ sessionId: 55, turnOrder: 1, state: "PRESENT", absentUntil: null }),
            ),
          },
        }),
      )
      .executeTest(
        asMember(async () => expect(await getGroup(7)).toMatchObject({ status: "IN_PROGRESS" })),
      ));

  it("10.4 없거나 참가자가 아니면 null(404 GROUP_NOT_FOUND)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("10.4 없는 그룹 조회")
      .withRequest("GET", missingGroup, (b) => b.headers(bearer))
      .willRespondWith(404, (b) => problem(b, notFound))
      .executeTest(asMember(async () => expect(await getGroup(999999999)).toBeNull())));

  it("10.5 준비하면 대기실을 다시 그린다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("그룹", { stage: "WAITING", mode: "CHAT" })
      .uponReceiving("10.5 준비 완료")
      .withRequest("PUT", groupPath("/ready"), (b) => b.headers(bearer).jsonBody({ ready: true }))
      .willRespondWith(200)
      .executeTest(asMember(async () => expect(await setGroupReady(7, true)).toEqual({}))));

  it("10.5 그룹이 없으면 홈으로 간다(404 GROUP_NOT_FOUND)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("10.5 없는 그룹 준비")
      .withRequest("PUT", `${missingGroup}/ready`, (b) =>
        b.headers(bearer).jsonBody({ ready: true }),
      )
      .willRespondWith(404, (b) => problem(b, notFound))
      .executeTest(
        asMember(() => expect(setGroupReady(999999999, true)).rejects.toThrow("REDIRECT /home")),
      ));

  it("10.5 시작한 그룹이면 서버 문구를 보인다(409 INVALID_GROUP_STATE)", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("그룹", { stage: "IN_PROGRESS", mode: "CHAT" })
      .uponReceiving("10.5 시작한 그룹 준비 취소")
      .withRequest("PUT", groupPath("/ready"), (b) => b.headers(bearer).jsonBody({ ready: false }))
      .willRespondWith(409, (b) => problem(b, invalidState, { generic: true }))
      .executeTest(
        asMember(async () =>
          expect(await setGroupReady(7, false)).toEqual({ formError: invalidState.detail }),
        ),
      ));

  it("10.6 나가면 홈으로 간다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("그룹", { stage: "WAITING", mode: "CHAT" })
      .uponReceiving("10.6 그룹 나가기")
      .withRequest("DELETE", groupPath("/participants/me"), (b) => b.headers(bearer))
      .willRespondWith(204)
      .executeTest(asMember(() => expect(leaveGroup(7)).rejects.toThrow("REDIRECT /home"))));

  it("10.6 이미 없는 그룹이면 나간 것으로 보고 홈으로 간다(404 GROUP_NOT_FOUND)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("10.6 없는 그룹 나가기")
      .withRequest("DELETE", `${missingGroup}/participants/me`, (b) => b.headers(bearer))
      .willRespondWith(404, (b) => problem(b, notFound))
      .executeTest(
        asMember(() => expect(leaveGroup(999999999)).rejects.toThrow("REDIRECT /home")),
      ));

  it("10.6 시작한 그룹이면 서버 문구를 보인다(409 INVALID_GROUP_STATE)", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("그룹", { stage: "IN_PROGRESS", mode: "CHAT" })
      .uponReceiving("10.6 시작한 그룹 나가기")
      .withRequest("DELETE", groupPath("/participants/me"), (b) => b.headers(bearer))
      .willRespondWith(409, (b) => problem(b, invalidState, { generic: true }))
      .executeTest(
        asMember(async () =>
          expect(await leaveGroup(7)).toEqual({ formError: invalidState.detail }),
        ),
      ));

  it("10.7 시작하면 내 면접 화면으로 간다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("그룹", { stage: "READY", mode: "CHAT" })
      .uponReceiving("10.7 그룹 면접 시작")
      .withRequest("POST", groupPath("/start"), (b) => b.headers(idempotent))
      .willRespondWith(200, (b) => b.jsonBody(like({ mySessionId: 55 })))
      .executeTest(
        asMember(() => expect(startGroup(7, KEY)).rejects.toThrow("REDIRECT /interview/55")),
      ));

  it("10.7 그룹이 없으면 홈으로 간다(404 GROUP_NOT_FOUND)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("10.7 없는 그룹 시작")
      .withRequest("POST", `${missingGroup}/start`, (b) => b.headers(idempotent))
      .willRespondWith(404, (b) => problem(b, notFound))
      .executeTest(
        asMember(() => expect(startGroup(999999999, KEY)).rejects.toThrow("REDIRECT /home")),
      ));

  it("10.7 아직 시작할 수 없으면 서버 문구를 보이고 멱등 키를 새로 만들게 한다(409 GROUP_NOT_READY)", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("그룹", { stage: "WAITING", mode: "CHAT" })
      .uponReceiving("10.7 자리가 차지 않은 그룹 시작")
      .withRequest("POST", groupPath("/start"), (b) => b.headers(idempotent))
      .willRespondWith(409, (b) =>
        problem(
          b,
          { detail: "아직 면접을 시작할 수 없어요.", code: "GROUP_NOT_READY" },
          { generic: true },
        ),
      )
      .executeTest(
        asMember(async () =>
          expect(await startGroup(7, KEY)).toEqual({
            formError: "아직 면접을 시작할 수 없어요.",
            keySpent: true,
          }),
        ),
      ));
});

describe("그룹 면접방", () => {
  it("10.8 화상 내 차례에 남은 시간이 30초 이하면 답변 시간을 늘린다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("그룹", { stage: "ANSWERING", mode: "VIDEO", nearDeadline: true })
      .uponReceiving("10.8 답변 시간 연장")
      .withRequest("POST", groupPath("/turn/extend"), (b) => b.headers(bearer))
      .willRespondWith(200)
      .executeTest(asMember(async () => expect(await extendTurn(7)).toEqual({ ok: true }))));

  it("10.8 늘릴 수 없으면 서버 문구를 보인다(409 EXTEND_NOT_ALLOWED)", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("그룹", { stage: "ANSWERING", mode: "CHAT" })
      .uponReceiving("10.8 채팅 그룹 면접 답변 시간 연장")
      .withRequest("POST", groupPath("/turn/extend"), (b) => b.headers(bearer))
      .willRespondWith(409, (b) =>
        problem(
          b,
          { detail: "지금은 답변 시간을 늘릴 수 없어요.", code: "EXTEND_NOT_ALLOWED" },
          { generic: true },
        ),
      )
      .executeTest(
        asMember(async () =>
          expect(await extendTurn(7)).toEqual({
            ok: false,
            formError: "지금은 답변 시간을 늘릴 수 없어요.",
          }),
        ),
      ));

  it("10.9 채팅 내 차례에 작성 중인 답변을 저장한다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("그룹", { stage: "ANSWERING", mode: "CHAT" })
      .uponReceiving("10.9 작성 중인 답변 저장")
      .withRequest(
        "PUT",
        providerPath(
          "/interview-sessions/${sessionId}/questions/${questionId}/draft",
          "/interview-sessions/55/questions/303/draft",
        ),
        (b) => b.headers(bearer).jsonBody({ content: "저는 결제 서버를" }),
      )
      .willRespondWith(204)
      .executeTest(
        asMember(() =>
          expect(saveAnswerDraft(55, 303, "저는 결제 서버를")).resolves.toBeUndefined(),
        ),
      ));
});
