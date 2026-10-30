import { MatchersV3 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";

import { getNotices } from "@/lib/notice/queries";
import { readNotice } from "@/lib/notice/actions";
import { asGuest, asMember, bearer, contract, problem, providerPath, shape } from "@/test/pact";
import type { InquiryListItem, InquiryMessage, InquiryResponse } from "@/types/api";

import {
  addInquiryMessage,
  closeInquiry,
  createGuestInquiry,
  createInquiry,
  openGuestInquiry,
} from "./actions";
import { getInquiry, getMyInquiries } from "./queries";

// 기준: Swagger 9.1~9.5 문의 · 8.8~8.9 공지 예시
const { like, eachLike, equal } = MatchersV3;
const pact = contract();

const values = {
  title: "비밀번호를 잊어버렸어요",
  content: "가입한 이메일은 a@ssafy.com이에요. 비밀번호를 바꿔 주세요.",
};
const message = {
  id: 21,
  authorType: "USER",
  content: values.content,
  createdAt: "2026-10-26T10:00:00+09:00",
} satisfies InquiryMessage;
// 상세 화면은 id · 제목 · 상태 · 메시지만, 목록은 여기에 작성일을 더 읽는다
const detailFields = {
  id: 7,
  title: values.title,
  status: "WAITING",
} satisfies Pick<InquiryListItem, "id" | "title" | "status">;
const summary = {
  ...detailFields,
  createdAt: "2026-10-26T10:00:00+09:00",
} satisfies Omit<InquiryListItem, "updatedAt">;
const inquiry = { ...detailFields, messages: [message] } satisfies Pick<
  InquiryResponse,
  "id" | "title" | "status" | "messages"
>;
const inquiryBody = {
  ...shape(detailFields, "status"),
  messages: eachLike(shape(message, "authorType")),
};
const detail = (path: string) =>
  providerPath(`/inquiries/\${inquiryId}${path}`, `/inquiries/7${path}`);
const guestPassword = { "X-Inquiry-Password": "1234" };

describe("문의(회원)", () => {
  it("9.1 문의를 쓰면 그 문의로 간다", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("9.1 문의 작성(회원)")
      .withRequest("POST", "/api/v1/inquiries", (b) => b.headers(bearer).jsonBody(values))
      .willRespondWith(201, (b) => b.jsonBody(like({ id: 7 })))
      .executeTest(asMember(() => expect(createInquiry(values)).rejects.toThrow("/inquiries/7"))));

  it("9.2 내 문의 목록을 받는다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("문의")
      .uponReceiving("9.2 내 문의 목록")
      .withRequest("GET", "/api/v1/inquiries", (b) =>
        b.headers(bearer).query({ page: "0", size: "10" }),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody({
          content: eachLike(shape(summary, "status")),
          page: shape({ totalPages: 1 }, "totalPages"),
        }),
      )
      .executeTest(
        asMember(async () => expect((await getMyInquiries(0)).content).toHaveLength(1)),
      ));

  it("9.3 문의를 조회한다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("문의")
      .uponReceiving("9.3 문의 조회(회원)")
      .withRequest("GET", detail(""), (b) => b.headers(bearer))
      .willRespondWith(200, (b) => b.jsonBody(inquiryBody))
      .executeTest(asMember(async () => expect(await getInquiry(7)).toEqual(inquiry))));

  it("9.3 없는 문의면 오류 코드를 던진다(404 INQUIRY_NOT_FOUND → 화면이 목록으로)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("9.3 없는 문의 조회(회원)")
      .withRequest("GET", "/api/v1/inquiries/999999999", (b) => b.headers(bearer))
      .willRespondWith(404, (b) => problem(b, { code: "INQUIRY_NOT_FOUND" }))
      .executeTest(
        asMember(() =>
          expect(getInquiry(999999999)).rejects.toMatchObject({
            response: { data: { code: "INQUIRY_NOT_FOUND" } },
          }),
        ),
      ));

  it("9.4 문의를 이어서 쓴다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("문의")
      .uponReceiving("9.4 문의 이어서 쓰기(회원)")
      .withRequest("POST", detail("/messages"), (b) =>
        b.headers(bearer).jsonBody({ content: "확인 부탁드려요." }),
      )
      // 회원 화면은 다시 그려(refresh) 9.3으로 메시지를 받으므로 응답 본문을 읽지 않는다
      .willRespondWith(201)
      .executeTest(
        asMember(async () =>
          expect(await addInquiryMessage(7, "확인 부탁드려요.")).not.toHaveProperty("error"),
        ),
      ));

  it("9.4 종료한 문의면 종료 상태로 다시 그린다(409 INQUIRY_CLOSED)", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("문의", { closed: true })
      .uponReceiving("9.4 종료한 문의에 이어서 쓰기")
      .withRequest("POST", detail("/messages"), (b) =>
        b.headers(bearer).jsonBody({ content: "확인 부탁드려요." }),
      )
      .willRespondWith(409, (b) =>
        problem(b, {
          detail: "종료한 문의예요.",
          code: "INQUIRY_CLOSED",
        }),
      )
      .executeTest(
        asMember(async () =>
          expect(await addInquiryMessage(7, "확인 부탁드려요.")).toMatchObject({ closed: true }),
        ),
      ));

  it("9.5 문의를 종료한다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("문의")
      .uponReceiving("9.5 문의 종료(회원)")
      .withRequest("POST", detail("/close"), (b) => b.headers(bearer))
      .willRespondWith(204)
      .executeTest(asMember(async () => expect(await closeInquiry(7)).toEqual({ ok: true }))));
  it.each([
    {
      name: "9.4 문의 이어서 쓰기",
      path: "/messages",
      call: () => addInquiryMessage(999999999, "확인 부탁드려요."),
    },
    { name: "9.5 문의 종료", path: "/close", call: () => closeInquiry(999999999) },
  ])("$name: 없는 문의면 알린다(404 INQUIRY_NOT_FOUND)", ({ name, path, call }) =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving(`${name} 없는 문의`)
      .withRequest("POST", `/api/v1/inquiries/999999999${path}`, (b) => {
        b.headers(bearer);
        if (path === "/messages") b.jsonBody({ content: "확인 부탁드려요." });
      })
      .willRespondWith(404, (b) =>
        problem(b, { detail: "문의를 찾을 수 없어요.", code: "INQUIRY_NOT_FOUND" }),
      )
      .executeTest(asMember(async () => expect(await call()).toMatchObject({ notFound: true }))),
  );
});

describe("문의(비회원)", () => {
  const guest = { email: "a@ssafy.com", accessPassword: "1234", ...values };

  it("9.1 비회원 문의를 쓰면 문의번호를 받는다", () =>
    pact
      .addInteraction()
      .uponReceiving("9.1 문의 작성(비회원)")
      .withRequest("POST", "/api/v1/inquiries", (b) => b.jsonBody(guest))
      .willRespondWith(201, (b) => b.jsonBody(like({ id: 7 })))
      .executeTest(
        asGuest(async () => expect(await createGuestInquiry(guest)).toEqual({ inquiryId: 7 })),
      ));

  it("9.3 문의번호와 조회 비밀번호로 연다", () =>
    pact
      .addInteraction()
      .given("비회원 문의")
      .uponReceiving("9.3 문의 조회(비회원)")
      .withRequest("GET", detail(""), (b) => b.headers(guestPassword))
      .willRespondWith(200, (b) => b.jsonBody(inquiryBody))
      .executeTest(
        asGuest(async () =>
          expect(await openGuestInquiry({ inquiryId: "7", accessPassword: "1234" })).toEqual({
            inquiry,
          }),
        ),
      ));

  it("9.4 비회원이 조회 비밀번호로 이어서 쓴다", () =>
    pact
      .addInteraction()
      .given("비회원 문의")
      .uponReceiving("9.4 문의 이어서 쓰기(비회원)")
      .withRequest("POST", detail("/messages"), (b) =>
        b.headers(guestPassword).jsonBody({ content: "확인 부탁드려요." }),
      )
      .willRespondWith(201)
      .executeTest(
        asGuest(async () =>
          expect(await addInquiryMessage(7, "확인 부탁드려요.", "1234")).not.toHaveProperty(
            "error",
          ),
        ),
      ));

  it("9.5 비회원이 조회 비밀번호로 종료한다", () =>
    pact
      .addInteraction()
      .given("비회원 문의")
      .uponReceiving("9.5 문의 종료(비회원)")
      .withRequest("POST", detail("/close"), (b) => b.headers(guestPassword))
      .willRespondWith(204)
      .executeTest(
        asGuest(async () => expect(await closeInquiry(7, "1234")).toEqual({ ok: true })),
      ));
});

describe("공지", () => {
  it("8.8 공지 목록을 받는다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("공지")
      .uponReceiving("8.8 공지 목록")
      .withRequest("GET", "/api/v1/notices", (b) => b.headers(bearer))
      .willRespondWith(200, (b) =>
        b.jsonBody({
          content: eachLike({
            id: 3,
            title: "10월 점검 안내",
            content: "10월 30일 02:00~04:00 서비스 점검이 있어요.",
            startsAt: "2026-10-23T09:00:00+09:00",
            read: equal(false),
          }),
        }),
      )
      .executeTest(
        asMember(async () => expect((await getNotices()).content.length).toBeGreaterThan(0)),
      ));

  it("8.9 공지를 확인한다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("공지")
      .uponReceiving("8.9 공지 확인")
      .withRequest("POST", providerPath("/notices/${noticeId}/read", "/notices/3/read"), (b) =>
        b.headers(bearer),
      )
      .willRespondWith(204)
      .executeTest(asMember(async () => expect(await readNotice(3)).toEqual({ ok: true }))));
});
