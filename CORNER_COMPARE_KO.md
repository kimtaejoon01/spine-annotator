# 자동 꼭지점도 계속 표시 + 잡히는 건 검수본만

## 변경
1. **자동(기존) 꼭지점을 항상 표시**
   - 교정 전: 기존처럼 색이 채워진 점 (SA 빨강 / SP 노랑 / IA 자홍 / IP 흰색)
   - 교정 후: 같은 색의 **속 빈 원(테두리만)** → "자동은 여기였다"가 계속 보임
2. **드래그로 잡히는 것은 검수본만**
   - 자동 꼭지점은 listening:false 로 두어 절대 잡히지 않음.
   - 교정된 추체는 파란 점(검수본)만 드래그 가능.
   - 아직 교정 안 한 추체는 자동 위치에 잡을 수 있는 핸들을 올려두어
     첫 교정이 가능(교정하는 순간 파란 검수점으로 바뀜).

## 결과
- 자동 점선 + 속 빈 자동 꼭지점 vs 검수 실선 + 채워진 파란 꼭지점
  → 두 결과 차이가 선/점 모두에서 한눈에 비교됨.

## 변경 파일
- public/static/annotator.js

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Keep auto corners visible (non-interactive); only review corners draggable"
  git push origin sagittal-measurements
  npm run deploy:preview
