// seed/accounts.json(seed.js가 만든 계정 목록)을 VU끼리 나눠 읽는다.
// ACCOUNT_OFFSET으로 노트북마다 다른 계정 범위를 쓴다(load_test_plan 6장 S5: 노트북 A는 1~10, B는 11~20).
import { SharedArray } from "k6/data";

const accounts = new SharedArray("accounts", () => JSON.parse(open("../seed/accounts.json")));
const OFFSET = Number(__ENV.ACCOUNT_OFFSET || 0);

/** VU 번호(1부터)에 맞는 계정 */
export function account(vu) {
  const i = OFFSET + vu - 1;
  if (i >= accounts.length) {
    throw new Error(`계정이 모자란다: ${i + 1}번째가 필요하지만 ${accounts.length}개뿐(seed.js COUNT를 늘린다)`);
  }
  return accounts[i];
}
