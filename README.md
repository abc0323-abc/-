# 다이스 마피아 — 온라인 MVP (정적 + Firebase)

## 준비
1) Firebase 프로젝트 생성
2) Authentication → Anonymous 활성화
3) Firestore 생성 (Production)
4) Firestore Rules는 `rules.txt` 내용으로 Publish
5) Firebase 웹앱 설정값을 `js/firebase-app.js`의 `firebaseConfig`에 붙여넣기

## 실행
- 로컬(모바일): Acode에서 `index.html` 열고 Preview
- 배포: GitHub Pages로 `/` 루트에 업로드 → URL 접속

## 기능
- 방 생성/참가(익명 로그인)
- 역할 배정(시민/마피아만, 호스트 전용)
- 낮/밤 전환(호스트 전용)
- 낮 투표 기록

## 주의
- 보안/치트 방어는 최소 수준. 상용 전 Cloud Functions 권장.
