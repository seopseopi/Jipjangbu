# 집장부 서비스 화면·브랜드 이미지

[서비스 소개](../../README.md) · [문서 모음](../README.md)

## 화면 갤러리

아래 파일은 합성 자료로 수행했던 실제 앱 검증의 캡처를 **편집 없이 복사**한 것입니다. 고객·매물·내용을 임의로 덧씌운 화면 모형이 아닙니다. 2026-09-13~14 검증 시점의 화면이므로 현재 운영 메뉴·배치와 일부 다를 수 있습니다.

| 공개 파일 | 검증 내용 | 출처 |
| --- | --- | --- |
| [journal-search.png](journal-search.png) | 묶음 업무의 두 번째 매물이 주소 검색에 일치하는 표시 | 2026-09-13, `workflow-review/layout-journal-two.png` |
| [work-detail.png](work-detail.png) | 여러 매물의 주소·가격·업소를 펼쳐 읽기 | 2026-09-13, `workflow-review/layout-detail-ten.png` |
| [safe-deletion.png](safe-deletion.png) | 저장된 원문·연결 매물·휴지통 복구 안내를 포함한 삭제 확인 | 2026-09-14, `deletion-geBX0y/delete-confirm-desktop.png` |
| [mobile-trash.png](mobile-trash.png) | 390px 휴대폰·큰 글씨의 휴지통 검색·기록·복구 | 2026-09-14, `deletion-geBX0y/trash-mobile-large.png` |

원본 캡처와 로컬 fixture는 개발 작업공간의 `output/playwright/` 아래에 보관되며 Git에서는 제외됩니다. 공개에는 위 이미지 4개만 선택했습니다. 출처 환경은 [실제 업무 흐름 점검](../workflow-review.md)과 [삭제·복구 E2E](../deletion-e2e-review.md)에 기록되어 있습니다.

공개 전 원본 이미지를 직접 열어 고객명·단지명·업무 내용이 `검증 고객`, `합성 업무`, `삭제 검증 고객` 등 합성 자료임을 확인했습니다. 계정·암호·운영 인증 값·실제 연락처가 포함된 화면, 로컬 인증 설정, SQLite 저장소, 백업 파일은 추가하지 않았습니다. 캡처의 수치와 가격은 운영 성과가 아닙니다.

## 브랜드 배너

![집장부 소개 배너](jipjangbu-cover.png)

- 파일: [`docs/assets/jipjangbu-cover.png`](jipjangbu-cover.png)
- 용도: GitHub README 상단 소개 배너. 실제 앱 화면이나 업무 데이터가 아닌 브랜드 일러스트입니다.
- 제작일: 2026-09-11
- 제작 방식: 내장 이미지 생성 도구 (`image_gen`), 새 이미지 생성. 외부 API / CLI 모드는 사용하지 않았습니다.
- 방향: 기존 집장부의 초록색·금색과 집·장부 모티프를 이어간 밝은 배경의 이미지입니다. 앱 로고 파일은 변경하지 않았습니다.
- 검수: 한글 제목·설명과 영문 표기, 밝은 배경에서의 대비를 확인했습니다. 실제 인물·고객 정보·실적 수치는 포함하지 않습니다.

## 최종 생성 프롬프트

```text
Use case: ads-marketing
Asset type: original GitHub README cover banner for the Korean web app 집장부 (Jipjangbu).
Primary request: create a polished, calm, editorial brand cover for a personal real-estate work ledger migrated from Excel to the web.
Scene/backdrop: warm ivory paper background, very subtle fine texture, generous whitespace, no outer mockup frame.
Subject: one sculptural miniature cream house rising from the folded pages of an open forest-green ledger, with a restrained gold accent. Refined tactile 3D paper / matte ceramic visual, grounded soft shadows, no floating random objects.
Composition/framing: wide landscape, approximately 2.4:1. Crisp typography occupies the left half with strong hierarchy; the house-and-ledger still life occupies the right half. Broad safe margins so text is readable at GitHub README width. Small eyebrow, very large Korean brand name, one short supporting line. No extra labels.
Lighting/mood: soft studio daylight, trustworthy, warm, carefully organized, high-end but approachable.
Color palette: warm ivory #F7F5EE, dark forest green #145447, subtle golden yellow #F2C764, gentle sage.
Text (verbatim): eyebrow "JIPJANGBU"; headline "집장부"; supporting line "고객 · 매물 · 업무를 한곳에"
Typography: dark forest-green bold Korean sans serif, perfectly legible with accurate Korean spelling. Render each text exactly once. The house is an illustration, NOT a screenshot or app UI.
Constraints: no real people, no customer records, no phone numbers, no dashboard mockups, no charts or invented statistics, no badges, no tech company logos, no watermark, no additional text. Opaque bright background suitable for both light and dark GitHub themes. Produce one finished raster image, not a code artifact.
```
