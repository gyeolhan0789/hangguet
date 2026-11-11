import { describe, expect, it } from "vitest";

import {
  GUEST_INQUIRY_CONSENT,
  keyedBlocks,
  PRIVACY_CONSENT,
  PRIVACY_POLICY,
  RECORDING_CONSENT,
  TERMS_OF_SERVICE,
  type LegalBlock,
} from "./documents";

const DOCUMENTS = [
  TERMS_OF_SERVICE,
  PRIVACY_POLICY,
  PRIVACY_CONSENT,
  RECORDING_CONSENT,
  GUEST_INQUIRY_CONSENT,
];

describe("keyedBlocks (본문 덩어리 key)", () => {
  it("같은 내용이 다시 나오면 몇 번째인지 붙여 key가 겹치지 않고, 순서와 덩어리는 그대로다", () => {
    const blocks: LegalBlock[] = [
      { kind: "heading", text: "제1조" },
      { kind: "paragraph", text: "없음" },
      { kind: "paragraph", text: "없음" },
      { kind: "list", ordered: false, items: ["가", "나"] },
      { kind: "table", head: ["항목", "기간"], rows: [["이메일", "종료 시까지"]] },
      { kind: "paragraph", text: "없음" },
    ];
    const keyed = keyedBlocks(blocks);
    expect(keyed.map(({ block }) => block)).toEqual(blocks);
    expect(keyed.map(({ key }) => key)).toEqual([
      "heading:제1조",
      "paragraph:없음",
      "paragraph:없음#1",
      "list:가\n나",
      "table:항목|기간:이메일|종료 시까지",
      "paragraph:없음#2",
    ]);
  });

  it.each(DOCUMENTS.map((doc) => [doc.title, doc] as const))(
    "%s: 덩어리 key가 모두 다르다",
    (_, doc) => {
      const keys = keyedBlocks(doc.blocks).map(({ key }) => key);
      expect(new Set(keys).size).toBe(keys.length);
    },
  );
});

describe("표", () => {
  // 화면은 칸을 머리글(열 이름)로 구분해 그리므로, 줄마다 머리글과 같은 수의 칸이 있고 열 이름이 겹치지 않아야 한다
  it.each(DOCUMENTS.map((doc) => [doc.title, doc] as const))(
    "%s: 줄마다 칸 수가 머리글과 같고 열 이름이 겹치지 않는다",
    (_, doc) => {
      for (const block of doc.blocks) {
        if (block.kind !== "table") continue;
        expect(new Set(block.head).size).toBe(block.head.length);
        for (const row of block.rows) expect(row).toHaveLength(block.head.length);
      }
    },
  );
});
