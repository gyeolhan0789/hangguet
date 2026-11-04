// 오리 면접관 효과음 출처 고지. 기준: public/interview/duck/CREDITS.txt(「화면 표기 문구」를 화면의 출처 고지에 그대로 표시, CC BY-SA 4.0)
// · API 명세 면접방 메시지(효과음은 CC BY-SA 4.0 녹음을 편집한 것이므로 화면의 출처 고지에 원본 출처를 표시한다)
// · 사용자 결정(2026-11-04: 오리 면접 화면 위쪽에 작은 '효과음 출처'를 두고, 누르면 문구를 펼친다). 펼침은 <details>로 한다.

const SOURCE_URL =
  "https://commons.wikimedia.org/wiki/File:Common_Eider_(Somateria_mollissima)_(W1CDR0001491_BD11).ogg";
const LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/deed.ko";

const link =
  "underline underline-offset-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

/** 오리 면접 화면의 '효과음 출처'. 누르면 출처 문구를 펼친다 */
export function DuckSoundCredit() {
  return (
    <details className="group max-w-[min(420px,calc(100vw-32px))] text-xs leading-normal text-white/70">
      <summary className="w-fit cursor-pointer rounded-sm font-semibold text-white/60 select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
        효과음 출처
      </summary>
      <div className="mt-2 flex flex-col gap-1 rounded-xl border border-white/10 bg-[rgba(14,16,22,0.8)] px-3.5 py-3 backdrop-blur-[8px]">
        <p className="font-bold text-white">오리 면접관 효과음</p>
        <p>
          원본:{" "}
          <a href={SOURCE_URL} target="_blank" rel="noreferrer" className={link}>
            Common Eider (Somateria mollissima) (W1CDR0001491 BD11)
          </a>
        </p>
        <p>녹음: Aubrey John Williams (1976년 10월 27일, 스코틀랜드 Loch Beag)</p>
        <p>저작권: © The British Library Board</p>
        <p>
          라이선스:{" "}
          <a href={LICENSE_URL} target="_blank" rel="noreferrer" className={link}>
            크리에이티브 커먼즈 저작자표시-동일조건변경허락 4.0 국제 (CC BY-SA 4.0)
          </a>
        </p>
        <p>
          변경 사항: 원본 녹음의 5.6~6.5초 구간을 잘라 배경 잡음을 줄이고 음량을 높였으며, 앞뒤를
          부드럽게 처리한 뒤 mp3로 변환했습니다. 이 효과음도 CC BY-SA 4.0에 따라 제공됩니다.
        </p>
        <p>원저작물은 라이선스에 따라 별도의 보증 없이 제공됩니다.</p>
        <p>
          이 서비스는 영국도서관(The British Library) 및 원저작자와 제휴하거나 그로부터 후원·보증을
          받지 않습니다.
        </p>
      </div>
    </details>
  );
}
