// 10. 그룹 면접 응답. 기준: BE Swagger 10.1 ~ 10.8(https://hangguet.yobistory.com/be/v3/api-docs) · API 명세 10.11 그룹 면접방 정보(LiveKit room metadata).
import type { OffsetDateTime } from "../common";
import type { Mode, Persona } from "../interview/request";
import type { PlanStatus, RoomResponse } from "../interview/response";
import type { JobCategory } from "./request";

/** 그룹 상태. WAITING 대기실 · IN_PROGRESS 진행 중 · START_FAILED 시작 실패(방장이 다시 시작) · ENDED 끝남 · CANCELLED 취소(모두 나감 · 만든 지 1시간) */
export type GroupStatus = "WAITING" | "IN_PROGRESS" | "START_FAILED" | "ENDED" | "CANCELLED";

/** 참가자 상태. WAITING 시작 전 · PRESENT 면접방에 있음 · ABSENT 진행 중 나감(2분 안에 돌아올 수 있음) · DONE 질문을 모두 마침 · ENDED 면접이 끝남 */
export type ParticipantState = "WAITING" | "PRESENT" | "ABSENT" | "DONE" | "ENDED";

/** 진행 단계. ASKING 질문 준비 · SPEAKING 질문 음성 중(입력 잠금) · ANSWERING 답변 중 · DECIDING 꼬리질문 판단 중 · WAITING 이탈한 참가자 재접속 대기 */
export type GroupPhase = "ASKING" | "SPEAKING" | "ANSWERING" | "DECIDING" | "WAITING";

/** 질문 종류. COMMON 공통 · PERSONAL 개인 맞춤 · FOLLOWUP 꼬리질문 */
export type TurnKind = "COMMON" | "PERSONAL" | "FOLLOWUP";

/** ENDED일 때 끝난 이유 */
export type ParticipantEndReason =
  "ALL_ANSWERED" | "USER_ENDED" | "DISCONNECTED" | "AI_FAILURE" | "CLEANUP";

/** 그룹 응답의 참가자(BE Swagger ParticipantResponse: 10.1 · 10.3 · 10.4 · 10.5 · 10.7 응답의 participants) */
export interface ParticipantResponse {
  userId: number;
  nickname: string;
  /** 프로필 사진 주소. 없으면 null */
  profileImageUrl: string | null;
  jobCategory: JobCategory;
  /** 참가자의 면접 id */
  sessionId: number;
  /** 면접 플랜(개인 맞춤 질문) 상태 */
  planStatus: PlanStatus;
  /** 준비 완료 */
  ready: boolean;
  /** 답변 순서(1부터). 시작 전에는 null */
  turnOrder: number | null;
  state: ParticipantState;
}

/** 지금 차례 */
export interface TurnInfo {
  /** 지금 답변자의 면접 id */
  sessionId: number;
  /** 그 면접 안의 질문 순서 1~6 */
  seq: number;
  kind: TurnKind;
  /** 몇 번째 기본 질문인지(1 공통 · 2 개인 · 3 공통 · 4 개인). 꼬리질문은 null */
  baseIndex: number | null;
  /** FULL 질문 전체를 말함 · CALL 같은 공통 질문의 다음 답변자 호명만 */
  announce: "FULL" | "CALL";
  /** 답변 마감. ANSWERING에서만, 그 밖에는 null */
  deadlineAt: OffsetDateTime | null;
  /** 이 질문에서 답변 시간을 연장했는지 */
  extended: boolean;
  /** 이 답변자가 더 받을 수 있는 꼬리질문 수 0~2 */
  followupsLeft: number;
}

/** 면접방 정보의 참가자 */
export interface RoomParticipant {
  sessionId: number;
  /** 답변 순서(1부터) */
  turnOrder: number;
  state: ParticipantState;
  /** ABSENT일 때 이 시각까지 다시 들어올 수 있다. 그 밖에는 null */
  absentUntil: OffsetDateTime | null;
  /** ENDED일 때 끝난 이유. 그 밖에는 null */
  endReason: ParticipantEndReason | null;
}

/** 그룹 면접방 정보(API 명세 10.11 LiveKit room metadata · BE Swagger RoomInfo). BE만 쓰고 화면은 읽는다 */
export interface RoomInfo {
  /** 바뀔 때마다 1씩 는다. 가진 값보다 작거나 같으면 버린다 */
  turnVersion: number;
  /** 이 정보를 만든 BE 시각. 화면은 자기 시계와의 차이로 deadlineAt을 보정한다 */
  serverTime: OffsetDateTime;
  groupStatus: GroupStatus;
  /** 현재 라운드 1~4 */
  round: number;
  /** 진행 단계. 남은 질문이 없으면 null */
  phase: GroupPhase | null;
  /** 지금 차례. 남은 질문이 없으면 null */
  turn: TurnInfo | null;
  participants: RoomParticipant[];
  /** 이 라운드에서 지금 답변자 다음에 답할 면접 id 순서 */
  upcoming: number[];
}

/** 10.1(201) · 10.3(201) · 10.4 · 10.5 · 10.7(200) */
export interface GroupResponse {
  groupId: number;
  status: GroupStatus;
  mode: Mode;
  persona: Persona;
  jobCategory: JobCategory;
  /** 정원 2 · 3 */
  capacity: number;
  /** 초대 코드 6자리. WAITING일 때만, 그 밖에는 null */
  inviteCode: string | null;
  /** 지금 방장 */
  hostUserId: number;
  /** 내 면접 id. 5.2 · 5.3 · 5.8 · 5.14 · 6.x에 쓴다 */
  mySessionId: number;
  /** 나가지 않은 참가자를 들어온 순서로 */
  participants: ParticipantResponse[];
  /** 내 직군이 그룹 직군과 다르면 true. 10.3 응답에만 값이 있고, 그 외에는 null */
  jobCategoryMismatch: boolean | null;
  /** 진행 중이면 면접방 정보와 같은 차례 정보, 그 밖에는 null */
  turn: RoomInfo | null;
  /** 방장의 면접방 입장 정보. 10.7 응답에만 값이 있고, 그 외에는 null */
  room: RoomResponse | null;
}

/** 10.2 초대 확인(200) */
export interface InviteResponse {
  groupId: number;
  /** 방장 닉네임 */
  hostNickname: string;
  mode: Mode;
  persona: Persona;
  jobCategory: JobCategory;
  capacity: number;
  /** 지금 인원(방장 포함) */
  participantCount: number;
}

/** 10.8 답변 시간 연장(200) */
export interface ExtendResponse {
  /** 늘어난 답변 마감 */
  deadlineAt: OffsetDateTime;
}

/** 5.2 면접 조회의 그룹 정보(API 명세 10.10). 개인 면접은 null */
export interface SessionGroup {
  groupId: number;
  status: GroupStatus;
}
