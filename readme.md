# TRPG 성향 테스트 웹사이트

D&D 9개 성향을 분석하는 인터랙티브 TRPG 웹 애플리케이션입니다.

## 호스팅 방법

### 옵션 1: Netlify (추천 - 가장 간단)

1. [Netlify](https://www.netlify.com/)에 가입
2. "Add new site" → "Deploy manually" 선택
3. `web` 폴더의 모든 파일을 드래그 앤 드롭
4. 배포 완료!

**또는 Git 연동:**
```bash
# Git 저장소에 푸시 후
# Netlify에서 GitHub 저장소 연결
```

### 옵션 2: Vercel

1. [Vercel](https://vercel.com/)에 가입
2. "New Project" 클릭
3. GitHub 저장소 연결 또는 파일 업로드
4. 배포 완료!

### 옵션 3: GitHub Pages

1. GitHub에 저장소 생성
2. Settings → Pages → Source를 `main` 브랜치로 설정
3. 저장소에 파일 푸시
4. `https://[username].github.io/[repository-name]`에서 접속

## 보안 주의사항

⚠️ **중요**: 현재 API 키가 클라이언트 코드에 하드코딩되어 있습니다. 
프로덕션 환경에서는 다음 중 하나를 사용하세요:

1. **서버리스 함수 사용** (Netlify Functions, Vercel Functions)
2. **백엔드 프록시 서버** 구축
3. **환경변수 관리** (서버 사이드에서만)

## 로컬 실행

```bash
python3 -m http.server 8000
```

브라우저에서 `http://localhost:8000` 접속

## 파일 구조

```
web/
├── index.html          # 메인 HTML 파일
├── styles.css          # 스타일시트
├── script.js           # JavaScript 로직
├── assets/             # 이미지 및 SVG 파일
└── README.md           # 이 파일
```

