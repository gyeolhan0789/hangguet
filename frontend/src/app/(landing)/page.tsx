import { FinalCta } from "./_components/final-cta";
import { GrowthSection } from "./_components/growth-section";
import { Hero } from "./_components/hero";
import { InterviewerSection } from "./_components/interviewer-section";
import { LandingFooter } from "./_components/landing-footer";
import { LandingHeader } from "./_components/landing-header";
import { LandingMotion } from "./_components/motion-utils";
import { StepsSection } from "./_components/steps-section";
import { StreakSection } from "./_components/streak-section";

// S00 랜딩. 앱 화면의 기본 레이아웃(헤더) 밖에 두고, 같은 헤더를 투명 모드로 쓴다.
export default function LandingPage() {
  return (
    <LandingMotion>
      <LandingHeader />
      <main>
        <Hero />
        <StreakSection />
        <InterviewerSection />
        <GrowthSection />
        <StepsSection />
        <FinalCta />
      </main>
      <LandingFooter />
    </LandingMotion>
  );
}
