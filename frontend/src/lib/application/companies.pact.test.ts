import { MatchersV3 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";

import { asMember, bearer, contract, shape } from "@/test/pact";
import type { CompanyItem } from "@/types/api";

import { getCompanies } from "./companies";

// 기준: Swagger 4.7 회사 목록 예시
const { atLeastLike, eachLike } = MatchersV3;
const pact = contract();

const company = { id: 2, name: "NAVER", aliases: ["naver", "네이버"] } satisfies CompanyItem;

describe("회사", () => {
  it("4.7 회사 목록을 받는다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("적재한 회사")
      .uponReceiving("4.7 회사 목록")
      .withRequest("GET", "/api/v1/companies", (b) => b.headers(bearer))
      .willRespondWith(200, (b) =>
        b.jsonBody({
          // 다른 회사와 겹친 별칭은 빠지므로 별칭이 없는 회사도 정상이다
          content: eachLike({ ...shape(company), aliases: atLeastLike(company.aliases[0], 0, 1) }),
        }),
      )
      .executeTest(
        asMember(async () =>
          expect(await getCompanies()).toEqual([{ ...company, aliases: [company.aliases[0]] }]),
        ),
      ));
});
