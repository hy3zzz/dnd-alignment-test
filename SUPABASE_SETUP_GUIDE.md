# Supabase 설정 가이드

D&D 성향 테스트의 DB 및 방명록 기능을 활성화하려면 Supabase를 설정해야 합니다.

## 1. Supabase 프로젝트 생성

1. [Supabase](https://supabase.com) 접속 후 로그인
2. **New Project** 클릭
3. 프로젝트 이름 입력 (예: `dnd-alignment-test`)
4. 데이터베이스 비밀번호 설정 (안전한 곳에 보관)
5. Region: **Northeast Asia (Seoul)** 선택 권장
6. **Create new project** 클릭

## 2. 데이터베이스 테이블 생성

1. Supabase Dashboard에서 **SQL Editor** 클릭
2. **New Query** 클릭
3. `supabase-setup.sql` 파일의 내용을 전체 복사하여 붙여넣기
4. **Run** 클릭하여 실행

## 3. API 키 확인

1. Supabase Dashboard에서 **Settings** > **API** 클릭
2. 아래 두 가지 값을 복사:
   - **Project URL** (예: `https://xxxxx.supabase.co`)
   - **anon public** key (예: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`)

## 4. script.js에 API 키 설정

`script.js` 파일을 열고 아래 부분을 수정:

```javascript
// ============================================
// Supabase 설정
// ============================================
const SUPABASE_URL = 'https://xxxxx.supabase.co'; // 여기에 Project URL 입력
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'; // 여기에 anon key 입력
```

## 5. 테스트

1. 웹사이트를 열고 게임을 진행
2. 결과 페이지에서 방명록이 표시되는지 확인
3. 방명록에 글을 남겨보고 정상적으로 저장되는지 확인

## 저장되는 데이터

### game_sessions (게임 세션)
| 필드 | 설명 |
|------|------|
| id | 세션 고유 ID |
| player_name | 플레이어 이름 |
| alignment | 최종 성향 결과 |
| alignment_scores | 성향 점수 (JSON) |
| created_at | 게임 시작 시간 |
| completed_at | 게임 완료 시간 |

### conversation_logs (대화 로그)
| 필드 | 설명 |
|------|------|
| id | 로그 고유 ID |
| session_id | 게임 세션 ID |
| timestamp | 대화 시간 |
| role | 역할 (user/assistant/system) |
| content | 대화 내용 |

### guestbook (방명록)
| 필드 | 설명 |
|------|------|
| id | 방명록 고유 ID |
| session_id | 게임 세션 ID (선택) |
| nickname | 닉네임 |
| message | 메시지 |
| alignment | 성향 결과 |
| created_at | 작성 시간 |

## 데이터 확인 방법

1. Supabase Dashboard > **Table Editor** 클릭
2. 각 테이블 선택하여 저장된 데이터 확인

## 문제 해결

### "Supabase 설정이 필요합니다" 메시지가 나올 때
- `SUPABASE_URL`과 `SUPABASE_ANON_KEY` 값이 `'YOUR_SUPABASE_URL'` 그대로인지 확인
- 실제 Supabase 프로젝트 값으로 교체

### 방명록이 저장되지 않을 때
- 브라우저 개발자 도구(F12) > Console 탭에서 에러 메시지 확인
- RLS 정책이 제대로 설정되었는지 확인

### 데이터가 보이지 않을 때
- Supabase Dashboard > Table Editor에서 직접 확인
- 인터넷 연결 상태 확인

## 보안 참고사항

- `anon key`는 클라이언트에서 사용해도 안전합니다 (Row Level Security로 보호됨)
- 하지만 `service_role` 키는 절대 클라이언트에 노출하면 안 됩니다
- 현재 설정은 모든 사용자가 읽기/쓰기 가능합니다. 필요시 RLS 정책을 수정하세요.

