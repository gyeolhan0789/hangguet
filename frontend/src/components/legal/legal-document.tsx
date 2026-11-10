import { keyedBlocks, type LegalDocument } from "@/lib/legal/documents";

// 약관 · 처리방침 · 동의서 본문을 그린다. 약관 페이지(/terms · /privacy)와 보기 모달(LegalModal)이 함께 쓴다.
// 기준: 개인정보 처리방침 작성지침(2026. 4.)의 표 · 목록 형식. 글꼴 · 색은 문의 화면(I03)의 본문 토큰을 따른다.

export function LegalDocumentView({
  doc,
  headingLevel = 2,
}: Readonly<{
  doc: LegalDocument;
  /** 소제목 단계. 페이지(h1 아래)는 2, 모달(h2 제목 아래)은 3 */
  headingLevel?: 2 | 3;
}>) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="flex flex-col gap-3 text-[15px] leading-relaxed font-medium break-keep text-text-2">
      {keyedBlocks(doc.blocks).map(({ key, block }) => {
        switch (block.kind) {
          case "heading":
            return (
              <Heading key={key} className="pt-3 text-base font-bold text-text-1 first:pt-0">
                {block.text}
              </Heading>
            );
          case "paragraph":
            return <p key={key}>{block.text}</p>;
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List
                key={key}
                className={`flex flex-col gap-1.5 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}
              >
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </List>
            );
          }
          case "table":
            return (
              <div key={key} className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="bg-surface text-text-1">
                    <tr>
                      {block.head.map((cell) => (
                        <th key={cell} scope="col" className="px-3 py-2 font-semibold">
                          {cell}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row) => (
                      <tr key={row.join("|")} className="border-t border-line">
                        {row.map((cell, j) => (
                          // 칸 key는 그 칸의 열 이름(문서마다 열 이름이 겹치지 않음 — documents.test)
                          <td key={block.head[j]} className="px-3 py-2 align-top">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
