/* ================================================================
   폴리곤 id 유일성 유틸 (순수 함수 — DOM/Konva 비의존, 테스트 가능)

   버그 배경:
     그리기용 id 카운터가 1부터 시작하는데, 저장된 파일을 불러올 때
     로드된 폴리곤의 id(이전 세션에서도 1부터 매겨진 작은 정수)와
     동기화되지 않았습니다. 그 결과 새로 그린 폴리곤이 로드된 폴리곤과
     같은 id 를 갖게 되고, id 로 삭제할 때 둘 다 지워졌습니다.

   해결:
     로드 시 (1) 카운터를 기존 최대 id 뒤로 밀고,
             (2) 중복/누락 id 를 새 값으로 교체해 유일성을 보장합니다.
   ================================================================ */

/**
 * 폴리곤 배열의 id 를 유일하게 만든다.
 * @param {Array<{id?:any}>} polygons
 * @param {number} counter - 다음에 부여할 id 시작값(그리기 카운터)
 * @returns {{ polygons: Array, nextCounter: number }}
 *   polygons: id 가 유일하게 보정된 새 배열(원본 필드는 보존)
 *   nextCounter: 이후 새 폴리곤에 안전하게 쓸 수 있는 카운터 값
 */
export function assignUniqueIds(polygons, counter = 1) {
  if (!Array.isArray(polygons)) return { polygons: [], nextCounter: counter }

  // pass 1: 유효한 기존 id 중 최댓값 파악
  let maxId = 0
  for (const p of polygons) {
    const id = Number(p && p.id)
    if (Number.isFinite(id) && id > maxId) maxId = id
  }

  // 카운터를 로드된 최대 id 뒤로 밀어 앞으로의 충돌을 원천 차단
  let next = counter <= maxId ? maxId + 1 : counter

  // pass 2: 누락되거나 중복된 id 만 새 값으로 교체 (기존 유일 id 는 유지)
  const seen = new Set()
  const out = polygons.map((p) => {
    let id = Number(p && p.id)
    if (!Number.isFinite(id) || seen.has(id)) id = next++
    seen.add(id)
    return { ...p, id }
  })

  return { polygons: out, nextCounter: next }
}
