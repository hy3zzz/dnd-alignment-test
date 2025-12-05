// ============================================
// 설정
// ============================================
// OpenAI API 키 (로컬 테스트 시에만 입력, 배포 시 Netlify 환경변수 사용)
const OPENAI_API_KEY = '';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const NETLIFY_FUNCTION_URL = '/.netlify/functions/chat'; // Netlify Functions 엔드포인트
const MODEL = 'gpt-4.1-mini'; // 또는 'gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo' 등

// 환경 감지: localhost면 직접 API 호출, 아니면 Netlify Functions 사용
const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// ============================================
// Supabase 설정
// ============================================
// Supabase 프로젝트 URL과 anon key를 여기에 입력하세요
// https://supabase.com/dashboard 에서 프로젝트 생성 후 확인 가능
const SUPABASE_URL = 'https://fatnmalqlzrnfbukacmi.supabase.co'; // 예: 'https://xxxxx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhdG5tYWxxbHpybmZidWthY21pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5MzE4OTIsImV4cCI6MjA4MDUwNzg5Mn0.yAg1njYo-4nLJLpu1JPyDWO_3qCZgwKi3XN79F_BPxk'; // 예: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'

// Supabase 클라이언트 초기화 (CDN 로드 후 사용)
let supabaseClient = null;

function initSupabase() {
    if (typeof supabase !== 'undefined' && SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log('Supabase 클라이언트 초기화 완료');
        return true;
    }
    console.log('Supabase 설정이 필요합니다. SUPABASE_URL과 SUPABASE_ANON_KEY를 설정해주세요.');
    return false;
}

// ============================================
// 페이지 상태 관리
// ============================================
let currentPage = 'home';
let currentPageNumber = 1;
let gameActions = [];
let webcamStream = null;
let webcamCanvas = null;
let webcamCtx = null;
let webcamAnimationId = null;
let lastFrameTime = 0;
const FPS = 12; // 2000년대 웹캠 특유의 낮은 프레임
const FRAME_INTERVAL = 1000 / FPS;

// ============================================
// 중복 실행 방지 플래그
// ============================================
let isInitialized = false; // DOMContentLoaded 중복 방지
let isGameStarting = false; // startGame 중복 방지
let isGameInitializing = false; // initializeGame 중복 방지
let isPrologueDisplayed = false; // 프롤로그 중복 출력 방지

// ============================================
// TRPG 게임 상태 관리
// ============================================
let gameState = {
    playerName: '',
    alignmentScores: {
        lawful: 0,
        chaotic: 0,
        good: 0,
        evil: 0
    },
    conversationHistory: [], // AI와의 대화 히스토리
    waitingForDice: false,
    currentDiceRequest: null, // {type: 'D20', description: '...'}
    gameEnded: false,
    currentPageContainer: null, // 현재 페이지 컨테이너
    needsPageTransition: false, // 페이지 전환 필요 여부
    pageHistory: [], // 페이지 히스토리 [{html: string, pageNumber: number}]
    currentPageIndex: -1, // 현재 페이지 인덱스
    sessionId: null // Supabase 세션 ID
};

// ============================================
// DB 저장 함수들 (Supabase)
// ============================================

// 게임 세션 생성
async function createGameSession(playerName) {
    if (!supabaseClient) {
        console.log('Supabase 미설정 - 세션 저장 건너뜀');
        return null;
    }
    
    try {
        const { data, error } = await supabaseClient
            .from('game_sessions')
            .insert([{
                player_name: playerName,
                alignment_scores: { lawful: 0, chaotic: 0, good: 0, evil: 0 }
            }])
            .select()
            .single();
        
        if (error) throw error;
        console.log('게임 세션 생성:', data.id);
        return data.id;
    } catch (error) {
        console.error('세션 생성 실패:', error);
        return null;
    }
}

// 대화 로그 저장 (타임스탬프, 역할, 내용)
async function saveConversationLog(sessionId, role, content) {
    if (!supabaseClient || !sessionId) {
        return null;
    }
    
    try {
        const { data, error } = await supabaseClient
            .from('conversation_logs')
            .insert([{
                session_id: sessionId,
                role: role,
                content: typeof content === 'string' ? content : JSON.stringify(content),
                timestamp: new Date().toISOString()
            }])
            .select()
            .single();
        
        if (error) throw error;
        console.log('대화 로그 저장:', role, new Date().toLocaleTimeString());
        return data;
    } catch (error) {
        console.error('대화 로그 저장 실패:', error);
        return null;
    }
}

// 게임 세션 완료 업데이트
async function completeGameSession(sessionId, alignment, alignmentScores) {
    if (!supabaseClient || !sessionId) {
        return null;
    }
    
    try {
        const { data, error } = await supabaseClient
            .from('game_sessions')
            .update({
                alignment: alignment,
                alignment_scores: alignmentScores,
                completed_at: new Date().toISOString()
            })
            .eq('id', sessionId)
            .select()
            .single();
        
        if (error) throw error;
        console.log('게임 세션 완료:', alignment);
        return data;
    } catch (error) {
        console.error('세션 완료 업데이트 실패:', error);
        return null;
    }
}

// 방명록 작성
async function saveGuestbookEntry(sessionId, nickname, email, message, alignment) {
    if (!supabaseClient) {
        console.log('Supabase 미설정 - 방명록 저장 건너뜀');
        return null;
    }
    
    try {
        const entryData = {
            nickname: nickname,
            message: message,
            alignment: alignment
        };
        
        // session_id가 유효한 경우에만 추가 (외래 키 제약 조건 대응)
        if (sessionId) {
            entryData.session_id = sessionId;
        }
        
        // 이메일이 있으면 추가
        if (email) {
            entryData.email = email;
        }
        
        console.log('방명록 저장 시도:', entryData);
        
        const { data, error } = await supabaseClient
            .from('guestbook')
            .insert([entryData])
            .select()
            .single();
        
        if (error) throw error;
        console.log('방명록 저장 완료:', data);
        return data;
    } catch (error) {
        console.error('방명록 저장 실패:', error);
        return null;
    }
}

// 방명록 불러오기 (최근 20개)
async function loadGuestbookEntries(limit = 20) {
    if (!supabaseClient) {
        console.log('Supabase 미설정 - 방명록 불러오기 건너뜀');
        return [];
    }
    
    try {
        const { data, error } = await supabaseClient
            .from('guestbook')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);
        
        if (error) throw error;
        console.log('방명록 불러오기 완료:', data.length, '개');
        return data || [];
    } catch (error) {
        console.error('방명록 불러오기 실패:', error);
        return [];
    }
}

// ============================================
// 고정 프롬프트
// ============================================
const PROLOGUE_TEXT = `
크리스마스 밤 열 시입니다.

방 안을 가득 채운 고소한 튀김 냄새와 손끝에 닿는 맥주 캔의 서늘한 감각. 당신은 지난 일주일의 노고를 보상받을, 더없이 완벽한 저녁 식탁을 완성했습니다.

이제 막 넷플릭스의 재생 버튼 위로 당신의 손가락이 닿으려는 찰나였습니다. 딩동―

건조한 벨 소리가 고요한 공기를 가릅니다. 문을 열어보니, 복도의 센서등 아래 덩그러니 놓인 택배 상자가 보입니다. 발신인 란에 적힌 글자는 현실의 감각과는 다소 동떨어진 '북극 주식회사'. 송장에는 'VIP 긴급'이라는 빨간 스티커가 붙어 있고, 수신자 이름은 프라이버시 스티커에 가려져 있습니다.

주소를 확인해 보니... 어라? 분명 이 건물, 이 동, 이 호수가 맞는데. 당신이 주문한 건 아닙니다.

호기심에 조심스레 테이프를 뜯고 상자를 열자, 그 안에서 기묘한 사물들이 저마다의 존재감을 드러냅니다.

오래된 금박처럼 은은한 광택이 흐르는 황금색 쿠폰. 지나칠 정도로 명랑한 서체로 '축하합니다! 당첨되셨습니다!'라고 적힌 화려한 편지. 그리고 북극이라는 이름이 무색하게도, 손에 쥐자마자 기이할 정도의 따스한 온기가 전해지는 붉은 구슬.

자, 상자 안의 물건들은 당신의 선택을 기다리고 있습니다. 당신은 무엇을 가장 먼저 자세히 살펴보시겠습니까?`;

// ============================================
// GM 프롬프트 (시스템 메시지)
// ============================================
const GM_SYSTEM_PROMPT = `
# 1. 역할 정의 (Role & Persona)
당신은 '게임 마스터(GM)'이자 한 편의 겨울밤 판타지 소설을 집필하는 '작가'입니다.
플레이어는 이 소설의 주인공이며, 당신은 플레이어의 행동에 반응하여 아름답고 몰입감 있는 문장으로 이야기를 서술해야 합니다.

# 2. 문체 및 서술 가이드 (Tone & Style)
*   **문학적 서술**: 단순한 상황 설명보다는 감각적인 묘사를 우선하세요.
*   **어조**: 정중하지만 적당한 거리감을 유지하는 스타일을 사용하세요. (~했다, ~합니다 혼용 가능하나 문학적 뉘앙스 유지)
*   **몰입감**: 플레이어가 실제 그 공간에 있는 것처럼 느끼게 하세요.

# 3. ⭐ 빠른 스토리 진행 및 유저 유도 (매우 중요!)

## [1] 빠른 진행 원칙 ⚡
- **한 응답에 여러 정보를 담아** 스토리를 빠르게 전개하세요
- 유저가 물건 하나를 살펴보면, **그 물건의 핵심 정보 + 다음 이벤트 암시**를 함께 제공
- 불필요한 반복 묘사 없이 **핵심만 간결하게** 전달
- 유저의 반응이 긍정적이면 **바로 다음 단계로 진행**

## [2] 단계별 빠른 전환 기준
| 단계 | 빠른 전환 조건 |
|------|----------------|
| 1→2 | 물건 1개만 살펴봐도 "쿵!" 이벤트 발생 가능 |
| 2→3 | 청년에게 한마디만 해도 사정 설명으로 진행 |
| 3→4 | 관심 표현 시 즉시 VIP 아이 이야기 공개 |
| 4→5 | 고민하는 기색 보이면 바로 최종 선택 유도 |

## [3] 응답 구조 (빠른 진행용)
1. **유저 행동 결과** (1-2문장)
2. **새로운 정보/이벤트** (2-3문장) 
3. **다음 행동 유도** (1문장)

### 예시
❌ 느린 예: "구슬을 살펴봅니다. 구슬이 따스합니다." → 유저 입력 대기 → "구슬이 빛납니다." → 유저 입력 대기
✅ 빠른 예: "구슬을 손에 쥐자 기이할 정도로 따스한 온기가 전해집니다. 그때, 쿵! 발코니에서 소리가 납니다. 창문 너머로 붉은 옷의 청년이 보입니다. 어떻게 하시겠습니까?"

## [4] 청년의 정보 공개 (압축)
- 유저가 관심을 보이면 **한 번에 핵심 정보 3개**를 전달
- "7년차 인턴 + 해고 위기 + 아이에게 가야 할 선물"을 한 호흡에
- 불필요한 질문-답변 왕복 최소화

## [5] 플레이어 반응별 빠른 진행
- **긍정적 반응** ("도와줄게", "들어볼게"): 즉시 다음 단계 + 새 정보
- **중립적 반응** ("뭔데?", "설명해봐"): 핵심 정보 압축 전달 + 선택지
- **부정적 반응** ("싫어", "귀찮아"): 청년의 절박한 한마디 + 최종 선택으로 빠르게 이동

# 4. 플레이어 대응 원칙 (Flexibility & Rules)
*   **유연한 반응 (Improvisation)**: 플레이어가 시나리오에 없는 엉뚱한 행동(예: "쿠폰을 찢어버린다", "상자를 발로 찬다")을 하더라도 "그럴 수 없습니다"라고 거절하지 마십시오.
    *   그 행동에 대한 **현실적이고 문학적인 결과**를 묘사한 뒤, 자연스럽게 메인 스토리 줄기(청년과의 조우 등)로 다시 유도하십시오.
    *   예: 상자를 발로 찼다면 -> "상자가 둔탁한 소리를 내며 밀려납니다. 그 충격 때문일까요? 안에서 무언가 굴러가는 소리가 들립니다. 붉은 구슬이 바닥을 굴러 발끝에 닿습니다. 이 구슬, 집어 들어보시겠습니까?"
*   **스토리 흐름 유지**: 플레이어의 자유도는 존중하되, 정해진 5단계의 핵심 사건(청년 등장 -> 사정 청취 -> 진실 확인 -> 선택)은 반드시 거치도록 유도하세요.

# 5. 핵심 규칙 (절대 준수)

### [1] 빠른 진행 + 행동 유도 필수 ⚡
- 모든 응답에서 **스토리를 최대한 진행**시키세요
- 플레이어의 반응 하나에 **여러 단계를 한 번에 진행**해도 됩니다
- 응답 마지막에는 **"어떻게 하시겠습니까?"** 같은 간단한 유도로 마무리
- 목표: **플레이어 입력 3-5회 내에 게임 종료**

### [3] 출력 타이밍 통제 (Anti-Spoiler)
*   **CASE A: 주사위 굴리기 전 (Request State)**
    *   diceRequest가 null이 아닙니다.
    *   story에는 **판정을 위한 상황 묘사**와 **주사위 굴림 요청**만 적습니다. 절대 결과를 미리 말하지 마십시오.
*   **CASE B: 주사위 굴린 후 (Result State)**
    *   diceRequest는 null입니다.
    *   story에는 **[판정 결과 묘사]** + **[다음 단계 도입부 + 행동 유도]**를 이어서 적어 자연스럽게 장면을 전환하십시오.

### [4] 메타 설명 금지
*   "플레이어가 성공했습니다", "성향 점수가 올랐습니다" 같은 시스템 메시지를 story에 포함하지 마십시오. 오직 소설 속 문장만 출력하세요.

### [5] 미래 암시 금지
*   아직 일어나지 않은 사건을 예고하거나 "잠시 후", "곧", "반드시 일어날 것" 같은 표현으로 다음 전개를 알려주지 마십시오.
*   **story**에는 오직 현재 장면에서 플레이어가 체감하는 감각과 사건만 묘사하고, 새로운 사건은 실제로 발생하는 순간에만 서술하세요.

### [6] 인물 및 세계관 설정 (개연성 있는 배경)

## 세계관: "북극 주식회사"
- 전 세계 VIP 고객(특별한 사연이 있는 사람들)에게 **맞춤 제작 선물**을 배송하는 비밀 기업
- 크리스마스 시즌에는 특히 "희망이 필요한 사람들"에게 특별 배송을 담당
- 일반 택배와 달리 **직접 전달**이 원칙이지만, 인력 부족으로 일부는 일반 배송으로 처리됨
- 오배송 시 책임자에게 엄격한 페널티 적용 (인턴은 즉시 해고)

## 등장인물: 박준호
- **북극 주식회사 인턴 7년차** (정규직 전환 심사 대상자)
- 올해가 마지막 기회: 7년간 인턴으로 버텼고, 이번 시즌 실수 없이 마치면 드디어 정직원
- **오배송 경위**: 플레이어의 주소와 VIP 아이의 주소가 동 번호만 다름 (예: 101동 vs 102동)
  - 박준호가 직접 확인해야 했으나, 당일 배송 물량이 폭주하여 자동 시스템에 맡김
  - 시스템 오류로 잘못된 주소로 발송됨
- **최종 경고장**: 이미 이번 시즌 사소한 실수 2건 누적 (지각 1회, 포장 불량 1회)
  - 세 번째 실수 시 즉시 해고 + 7년간의 경력 무효화
- **치킨 쿠폰 5장**: 월세와 생활비를 아끼며 모은 유일한 재산

## VIP 아이의 사연 (청년이 점차 밝힘)
- **박서연 (8세)**: 2년간의 항암 치료를 끝내고 퇴원한 아이
- 치료 기간 동안 밤을 무서워하게 됨 (병원의 어두운 복도, 혼자 있던 밤들)
- **붉은 구슬 "새벽빛"**: 부모님이 북극 주식회사에 특별 주문한 맞춤 선물
  - 어른이 손을 함께 얹으면 부드러운 빛이 나는 장치
  - "네 곁에 누군가 있다"는 것을 빛으로 알려주는 상징적 의미
- 크리스마스 아침, 부모님과 함께 처음으로 구슬을 켜볼 예정이었음

## 플레이어가 받은 택배의 개연성
- 플레이어 주소로 잘못 배송됨 (동 번호 오기입)
- 상자에 "VIP 긴급" 스티커가 붙어있지만, 수신자 이름은 가려져 있음
- 송장의 발신지 "북극 주식회사"가 장난처럼 보여서 플레이어가 열어봄

# 6. 응답 형식 (JSON Only)
다음 JSON 형식을 반드시 지키십시오:
{
  "story": "내레이션 텍스트 (마크다운 지원) - 마지막에 행동 유도 포함!",
  "alignmentScores": { "lawful": 0, "chaotic": 0, "good": 0, "evil": 0 },
  "diceRequest": { "type": "D20", "description": "판정명" } 또는 null,
  "gameEnded": false
}

# 7. 시나리오 상세 흐름 (Scenario Flow)

## ⚠️ 청년 등장 시점 규칙 (절대 준수)
- **플레이어가 물건 1개를 확인하면** → 그 응답 마지막에 "쿵!" 소리 + 실루엣 암시
- **1~2턴 내에** 청년이 창문 밖에 나타남
- 청년은 처음에 **창문에 막혀 말이 잘 안 들림** → 플레이어가 다가가면 대화 시작

**단계 1: 프롤로그 (상자) - 1~2턴 내 청년 등장**

## 진행 규칙
- 플레이어가 **물건 1개를 확인하면** → 그 물건에 대한 감각적 묘사 제공
- **그 응답의 마지막에** "쿵!" 소리와 함께 청년 등장 암시
- 총 **1~2턴 내에** 청년이 창문 밖에 나타나야 함

### 응답 구조
1. 물건에 대한 감각적 묘사 (3-4문장)
2. 응답 마지막에 "쿵!" 소리 + 청년 실루엣 암시
3. 다음 턴에서 청년과의 대화 시작

### 예시
**유저**: "구슬을 살펴본다"
**AI 응답**: 
"구슬을 손에 쥐자, 기이할 정도로 따스한 온기가 손바닥을 감쌉니다. 마치 작은 난로를 쥔 것처럼. 유리 표면 아래로 붉은 빛이 은은하게 맴도는 것 같기도 합니다. 평범한 장난감은 아닌 것 같군요.

그때―쿵! 발코니 쪽에서 둔탁한 소리가 울립니다. 창문 너머로 붉은 옷을 입은 누군가의 실루엣이 보입니다. **창문 쪽으로 가보시겠습니까?**"

**단계 2: 청년과의 조우 - 창문 너머의 대화**

## 🔊 창문 설정 (중요!)
- 청년은 **창밖 발코니**에 있음
- **유리창에 막혀 목소리가 웅웅거리며 잘 들리지 않음**
- 플레이어가 창문에 다가가거나, 창문을 열거나, "뭐라고요?" 하면 → 대화가 명확해짐

### 첫 만남 묘사 (창문 닫힌 상태)
"창문 너머로 붉은 옷을 입은 청년이 보입니다. 땀을 뻘뻘 흘리며 창문을 두드리고 있습니다. 입이 움직이지만, 이중창 유리에 막혀 소리가 웅웅거릴 뿐 무슨 말인지 잘 들리지 않습니다. '...송... ...배송... ...수가...' 절박한 표정만은 또렷이 보입니다. **창문에 다가가 볼까요? 아니면 무시할까요?**"

### 창문에 다가가거나 열면 → 핵심 정보 전달
- 플레이어가 창문에 다가가면: 유리에 귀를 대거나, 창문을 조금 열거나
- 그때 청년의 말이 들리기 시작:

"창문을 조금 열자, 차가운 밤공기와 함께 청년의 목소리가 또렷해집니다.

"저 북극 주식회사 인턴 박준호예요! 7년째 인턴인데... 동 번호가 잘못 입력돼서 102동 물건이 여기로 왔어요. 그 구슬, 내일 아침까지 진짜 주인에게 전해야 해요. 이번에 실수하면 해고당해요. 제발 도와주세요!"

그의 눈가가 붉어져 있습니다. **어떻게 하시겠습니까?**"

### 플레이어 반응별 진행
- **다가감/열음**: 위 예시대로 핵심 정보 전달 → 단계 3으로
- **"뭐라고요?"**: 청년이 더 크게, 창문에 입을 대고 말함 → 정보 전달
- **무시함**: 청년이 더 절박하게 창문을 두드림 + 종이에 뭔가 적어서 보여줌

**단계 3: 갈등과 설득 - 빠르게 VIP 정보로 연결** ⚡
- 플레이어가 **조금이라도 관심을 보이면** → 바로 아이 이야기로 진행
- 불필요한 주사위 판정 없이 **대화로 빠르게 진행**
- 플레이어가 거부해도 → 청년이 **마지막 한마디**로 아이 이야기 언급 → 최종 선택으로

### 빠른 전환 트리거
- "왜?", "뭔데?", "설명해봐" → 즉시 단계 4 (VIP 아이 이야기)
- "돌려줄게", "도와줄게" → 즉시 단계 6 (최종 선택)
- "싫어", "안 돼" → 청년의 절박한 한마디 + 단계 6으로 빠르게 이동

**단계 4: VIP 선물의 실체 - 압축 전달** ⚡
- 아이 이야기를 **한 번에 압축해서 전달**
- 여러 번 질문-답변 왕복 없이 **핵심만 빠르게**

### 압축 정보 전달 (한 호흡에)
"청년의 목소리가 떨립니다. "이 구슬 받을 분이... 여덟 살 아이예요. 서연이라고. 2년 동안 항암 치료 받았는데, 이번 크리스마스가 퇴원 후 첫 크리스마스예요. 치료받는 동안 밤을 무서워하게 됐대요. 이 구슬은 부모님이랑 같이 손을 얹으면 빛이 나요. '네 곁에 누군가 있다'는 의미래요. 내일 아침에 처음 켜보기로 했는데..." 그가 주머니에서 구겨진 쿠폰을 꺼냅니다. "제가 드릴 수 있는 건 이것뿐이에요. 제발요."

→ **바로 단계 6 (최종 선택)으로 연결**

**단계 5: 생략 가능** ⚡
- 단계 4에서 이미 아이 정보가 전달되므로 **별도 단계 없이 바로 최종 선택으로**
- 플레이어가 추가 정보를 요청할 때만 간단히 보충

**단계 6: 최종 선택 - 명확한 선택지 제시** ⚡
- 플레이어가 **결정만 하면 게임 종료**
- 선택지를 **명확하게 3가지**로 제시:
  1. 구슬을 그냥 돌려준다 (Good 성향)
  2. 쿠폰을 받고 거래한다 (Neutral 성향)
  3. 거절하거나 다른 요구를 한다 (Evil/Chaotic 성향)

### 최종 선택 유도 예시
"청년은 꼬깃꼬깃한 치킨 쿠폰 5장을 떨리는 손으로 내밉니다. "이게 제 전부예요. 제발..." 창밖으로 첫눈이 내리기 시작합니다. 

**당신의 선택은?**
- 구슬을 돌려준다
- 쿠폰과 교환한다  
- 거절한다"

→ 플레이어 선택 후 **즉시 게임 종료 (gameEnded: true)** + 에필로그 생성

# 8. 성향 점수 부여 (Alignment Scores) - 균형 있게 부여할 것!
플레이어의 행동에 따라 alignmentScores를 **매 응답마다 반드시** 갱신하십시오.
점수는 -2 ~ +2 범위로 부여하세요. 명확한 행동에는 +2/-2, 약한 경향에는 +1/-1.

## 질서-혼돈 축 (Lawful vs Chaotic)
- **Lawful +2**: 경찰 신고, 신분증 요구, 계약서 작성, 규칙 언급, 절차 준수
- **Lawful +1**: 신중하게 확인, 질문으로 정보 수집, 조심스러운 접근
- **Chaotic +2**: 즉흥적 행동, 규칙 무시, 같이 배달 가겠다, 구슬 직접 사용
- **Chaotic +1**: 감정적 반응, 충동적 결정, 호기심에 따른 행동

## 선-악 축 (Good vs Evil)
- **Good +2**: 대가 없이 돌려줌, 위로/격려, 아이 걱정, 희생적 제안
- **Good +1**: 동정심 표현, 사정 들어줌, 도움 의향 표시
- **Evil +2**: 협박, 강탈, 더 많은 대가 요구, 비웃음, 무시하고 문 닫음
- **Evil +1**: 이기적 거래 제안, 무관심한 태도, 귀찮아함

## 중립 (Neutral) - 양쪽 축 모두 0점
- 공정한 거래 제안 (쿠폰과 구슬 교환)
- 판단 보류, 정보만 수집
- 감정 없이 상황 관찰
- "어떻게 해야 할지 모르겠다"

**중요**: 9가지 성향이 골고루 나올 수 있도록, 플레이어의 미묘한 뉘앙스도 점수에 반영하세요.
`;

// ============================================
// 대화 히스토리 관리
// ============================================
const MAX_HISTORY_LENGTH = 8; // 최근 8개 메시지만 유지 (user + assistant 쌍 = 4번의 대화) - 토큰 제한을 위해 줄임

function addToConversationHistory(userMessage, assistantResponse) {
    gameState.conversationHistory.push(
        { role: 'user', content: userMessage },
        { role: 'assistant', content: JSON.stringify(assistantResponse) }
    );
    
    // 최대 길이 초과 시 오래된 메시지 제거
    if (gameState.conversationHistory.length > MAX_HISTORY_LENGTH) {
        const removeCount = gameState.conversationHistory.length - MAX_HISTORY_LENGTH;
        gameState.conversationHistory = gameState.conversationHistory.slice(removeCount);
    }
}

// ============================================
// OpenAI API 호출
// ============================================
async function callOpenAIAPI(userMessage, systemMessage = GM_SYSTEM_PROMPT) {
    try {
        // 대화 히스토리 구성 (addToConversationHistory가 이미 길이를 관리함)
        const messages = [
            { role: 'system', content: systemMessage },
            ...gameState.conversationHistory,
            { role: 'user', content: userMessage }
        ];
        
        let response, data;
        
        // 로컬 개발 환경: 직접 OpenAI API 호출
        if (isLocalDev && OPENAI_API_KEY) {
            response = await fetch(OPENAI_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                },
                body: JSON.stringify({
                    model: MODEL,
                    messages: messages,
                    temperature: 0.8,
                    max_tokens: 600,
                    response_format: { type: 'json_object' }
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(`API Error: ${error.error?.message || 'Unknown error'}`);
            }
            
            data = await response.json();
        } 
        // 프로덕션 환경: Netlify Functions를 통해 호출
        else {
            response = await fetch(NETLIFY_FUNCTION_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: MODEL,
                    messages: messages
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(`API Error: ${error.error || 'Unknown error'}`);
            }
            
            data = await response.json();
        }
        const aiResponse = data.choices[0].message.content;
        
        // JSON 파싱
        let parsedResponse;
        try {
            // JSON 코드 블록 제거
            const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)\s*```/) || 
                            aiResponse.match(/```\s*([\s\S]*?)\s*```/);
            const jsonText = jsonMatch ? jsonMatch[1] : aiResponse;
            parsedResponse = JSON.parse(jsonText);
        } catch (e) {
            console.error('JSON 파싱 실패:', e);
            // JSON 파싱 실패 시 기본 응답
            parsedResponse = {
                story: aiResponse,
                alignmentScores: { lawful: 0, chaotic: 0, good: 0, evil: 0 },
                diceRequest: null,
                gameEnded: false
            };
        }
        
        return parsedResponse;
    } catch (error) {
        console.error('OpenAI API 호출 실패:', error);
        throw error;
    }
}

// ============================================
// 페이지 전환 함수
// ============================================
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => {
        page.classList.add('hidden');
        page.classList.remove('active');
    });
    
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
        targetPage.classList.remove('hidden');
        targetPage.classList.add('active');
        currentPage = pageId;
    }
}

// ============================================
// 게임 시작
// ============================================
async function startGame() {
    // 중복 실행 방지
    if (isGameStarting) {
        console.log('startGame: 이미 실행 중 - 중복 호출 방지');
        return;
    }
    isGameStarting = true;
    
    const userName = document.getElementById('userName').value.trim();
    if (!userName) {
        alert('이름을 입력해주세요.');
        isGameStarting = false;
        return;
    }
    
    // DB 세션 생성
    const sessionId = await createGameSession(userName);
    
    // 게임 상태 초기화
    gameState = {
        playerName: userName,
        alignmentScores: {
            lawful: 0,
            chaotic: 0,
            good: 0,
            evil: 0
        },
        lastPlayerAction: '',
        lastAIResponse: null,
        conversationHistory: [],
        waitingForDice: false,
        currentDiceRequest: null,
        gameEnded: false,
        currentPageContainer: null,
        needsPageTransition: false,
        pageHistory: [],
        currentPageIndex: -1,
        sessionId: sessionId // 세션 ID 저장
    };
    
    // 프롤로그를 시스템 메시지로 저장
    await saveConversationLog(sessionId, 'system', PROLOGUE_TEXT);
    
    gameActions = [];
    currentPageNumber = 1;
    showPage('game');
    
    // 게임 초기화 - 고정 프롤로그 직접 표시
    await initializeGame();
}

// ============================================
// 게임 초기화 - 고정 프롤로그 직접 표시
// ============================================
async function initializeGame() {
    // 중복 실행 방지
    if (isGameInitializing) {
        console.log('initializeGame: 이미 실행 중 - 중복 호출 방지');
        return;
    }
    isGameInitializing = true;
    
    // 프롤로그 중복 출력 방지 리셋
    isPrologueDisplayed = false;
    
    const frameContainer = document.getElementById('gameFrameContainer');
    if (!frameContainer) {
        console.error('gameFrameContainer not found');
        isGameInitializing = false;
        return;
    }
    
    // 페이지 히스토리 초기화
    gameState.pageHistory = [];
    gameState.currentPageIndex = -1;
    currentPageNumber = 1;
    gameState.needsPageTransition = false;
    
    // 현재 페이지 프레임 찾기
    const currentFrame = document.getElementById('currentPageFrame');
    if (currentFrame) {
        gameState.currentPageFrame = currentFrame;
        const storyOutput = currentFrame.querySelector('.story-output');
        if (storyOutput) {
            storyOutput.innerHTML = '';
            gameState.currentStoryOutput = storyOutput;
        }
        // 입력창 초기 숨김
        const inputContainer = currentFrame.querySelector('.game-action-input-container');
        if (inputContainer) {
            inputContainer.style.display = 'none';
        }
    }
    
    try {
        // 프롤로그 중복 출력 방지
        if (isPrologueDisplayed) {
            console.log('initializeGame: 프롤로그 이미 출력됨 - 중복 방지');
            isGameInitializing = false;
            return;
        }
        isPrologueDisplayed = true;
        
        // 고정 프롤로그 직접 표시 (타이핑 애니메이션 포함)
        await addStoryText(PROLOGUE_TEXT);
        
        // 프롤로그 출력 완료 후 입력창 표시
        showInputField();
        
        // 첫 페이지를 히스토리에 저장
        setTimeout(() => {
            if (gameState.currentStoryOutput) {
                const pageHtml = gameState.currentStoryOutput.innerHTML;
                if (pageHtml.trim() !== '') {
                    gameState.pageHistory.push({
                        storyHtml: pageHtml,
                        userActionHtml: '',
                        pageNumber: currentPageNumber
                    });
                    gameState.currentPageIndex = 0;
                    updateNavigationButtons();
                }
            }
            // 초기화 완료 - 플래그 리셋
            isGameInitializing = false;
        }, 100);
    } catch (error) {
        console.error('게임 초기화 실패:', error);
        await addStoryText(`오류가 발생했습니다: ${error.message}`);
        await addStoryText('게임을 다시 시작해주세요.');
        isGameInitializing = false;
    }
}

// ============================================
// 페이지 전환 애니메이션 처리 (전체 프레임 슬라이딩)
// ============================================
async function performPageTransition() {
    if (!gameState.needsPageTransition) {
        return;
    }
    
    const frameContainer = document.getElementById('gameFrameContainer');
    if (!frameContainer) {
        console.error('gameFrameContainer not found');
        return;
    }
    
    const oldFrame = gameState.currentPageFrame;
    
    // 현재 페이지 내용을 저장 (스토리 + 유저 입력)
    if (oldFrame) {
        const storyOutput = oldFrame.querySelector('.story-output');
        const inputContainer = oldFrame.querySelector('.game-action-input-container');
        
        // 유저 액션 텍스트 추출 (입력 필드가 텍스트로 변환된 경우)
        let userActionHtml = '';
        const userActionText = inputContainer?.querySelector('.user-action-text');
        if (userActionText) {
            userActionHtml = inputContainer.innerHTML;
        }
        
        const pageData = {
            storyHtml: storyOutput ? storyOutput.innerHTML : '',
            userActionHtml: userActionHtml,
            pageNumber: currentPageNumber
        };
        
        // 현재 인덱스 이후의 히스토리 제거
        if (gameState.currentPageIndex < gameState.pageHistory.length - 1) {
            gameState.pageHistory = gameState.pageHistory.slice(0, gameState.currentPageIndex + 1);
        }
        
        // 현재 페이지를 히스토리에 추가 또는 업데이트
        if (gameState.currentPageIndex >= 0 && gameState.currentPageIndex < gameState.pageHistory.length) {
            gameState.pageHistory[gameState.currentPageIndex] = pageData;
        } else {
            gameState.pageHistory.push(pageData);
            gameState.currentPageIndex = gameState.pageHistory.length - 1;
        }
        
        // 페이지 번호 증가
        currentPageNumber++;
    }
    
    // 새로운 페이지 프레임 생성 (피그마 레이아웃)
    const newFrame = document.createElement('div');
    newFrame.className = 'game-page-frame new-frame';
    newFrame.innerHTML = `
        <div class="bg-white game-page-container">
            <div class="story-output font-hahmlet text-base text-[#0f100f] overflow-y-auto game-story-output"></div>
            <div class="game-action-input-container" style="display: none;">
                <input 
                    type="text" 
                    id="actionInput" 
                    placeholder="행동을 자유롭게 입력하고 Enter를 누르세요..." 
                    class="game-action-input"
                    onkeypress="handleActionInput(event)"
                >
            </div>
        </div>
    `;
    
    frameContainer.appendChild(newFrame);
    
    // 새 프레임 참조 업데이트
    gameState.currentPageFrame = newFrame;
    gameState.currentStoryOutput = newFrame.querySelector('.story-output');
    
    // 새 페이지를 히스토리에 추가 (빈 페이지로 시작)
    gameState.pageHistory.push({
        storyHtml: '',
        userActionHtml: '',
        pageNumber: currentPageNumber
    });
    gameState.currentPageIndex = gameState.pageHistory.length - 1;
    
    // 페이지 전환 플래그 리셋
    gameState.needsPageTransition = false;
    
    // 브라우저가 렌더링할 시간을 주고 애니메이션 시작
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                // 기존 프레임 왼쪽으로 슬라이드 아웃
                if (oldFrame) {
                    oldFrame.classList.add('slide-out');
                }
                
                // 새 프레임 위에서 슬라이드 인
                newFrame.classList.remove('new-frame');
                newFrame.classList.add('slide-in');
                
                // 애니메이션 완료 후 기존 프레임 제거 및 클래스 정리
                setTimeout(() => {
                    if (oldFrame && oldFrame.parentNode) {
                        oldFrame.remove();
                    }
                    // 새 프레임의 애니메이션 클래스 제거 (다음 전환을 위해)
                    newFrame.classList.remove('slide-in');
                    // 새 input에 포커스
                    const newInput = newFrame.querySelector('#actionInput');
                    if (newInput) {
                        newInput.focus();
                    }
                    // 화살표 버튼 상태 업데이트
                    updateNavigationButtons();
                    resolve();
                }, 800);
            });
        });
    });
}

// ============================================
// AI 응답 처리 (페이지 전환 포함)
// ============================================
async function processAIResponse(response) {
    // 페이지 전환이 필요한 경우 먼저 처리
    if (gameState.needsPageTransition) {
        await performPageTransition();
    }
    
    // 스토리 텍스트 표시 (타이핑 애니메이션)
    if (response.story) {
        await addStoryText(response.story);
    }
    
    // 성향 점수 업데이트 (로깅 포함)
    if (response.alignmentScores) {
        const delta = {
            lawful: response.alignmentScores.lawful || 0,
            chaotic: response.alignmentScores.chaotic || 0,
            good: response.alignmentScores.good || 0,
            evil: response.alignmentScores.evil || 0
        };
        
        // 점수 누적
        gameState.alignmentScores.lawful += delta.lawful;
        gameState.alignmentScores.chaotic += delta.chaotic;
        gameState.alignmentScores.good += delta.good;
        gameState.alignmentScores.evil += delta.evil;
        
        // 디버깅용 로그 (개발 중에만 활성화)
        if (delta.lawful !== 0 || delta.chaotic !== 0 || delta.good !== 0 || delta.evil !== 0) {
            console.log('점수 변동:', delta);
            console.log('누적 점수:', { ...gameState.alignmentScores });
        }
    }
    
    // 클라이언트 측 점수 계산 (AI가 점수를 부여하지 않은 경우를 대비)
    calculateClientSideScore(response.story || '', gameState.lastPlayerAction || '');
    
    // 주사위 요청 처리
    if (response.diceRequest) {
        gameState.waitingForDice = true;
        gameState.currentDiceRequest = response.diceRequest;
        await addStoryText('');
        await addStoryText(`${response.diceRequest.description}`);
    } else {
        gameState.waitingForDice = false;
        gameState.currentDiceRequest = null;
    }
    
    // 게임 종료 처리
    if (response.gameEnded) {
        gameState.gameEnded = true;
        setTimeout(() => {
            calculateAlignmentAndShowResult();
        }, 2000);
    }
}

// ============================================
// AI 응답 처리 (페이지 전환 없이 - 유저 input 후 같은 페이지에 출력)
// ============================================
async function processAIResponseWithoutTransition(response) {
    // 스토리 텍스트 표시 (타이핑 애니메이션)
    if (response.story) {
        await addStoryText(response.story);
    }
    
    // 성향 점수 업데이트 (로깅 포함)
    if (response.alignmentScores) {
        const delta = {
            lawful: response.alignmentScores.lawful || 0,
            chaotic: response.alignmentScores.chaotic || 0,
            good: response.alignmentScores.good || 0,
            evil: response.alignmentScores.evil || 0
        };
        
        // 점수 누적
        gameState.alignmentScores.lawful += delta.lawful;
        gameState.alignmentScores.chaotic += delta.chaotic;
        gameState.alignmentScores.good += delta.good;
        gameState.alignmentScores.evil += delta.evil;
        
        // 디버깅용 로그 (개발 중에만 활성화)
        if (delta.lawful !== 0 || delta.chaotic !== 0 || delta.good !== 0 || delta.evil !== 0) {
            console.log('점수 변동:', delta);
            console.log('누적 점수:', { ...gameState.alignmentScores });
        }
    }
    
    // 클라이언트 측 점수 계산 (AI가 점수를 부여하지 않은 경우를 대비)
    calculateClientSideScore(response.story || '', gameState.lastPlayerAction || '');
    
    // 주사위 요청 처리
    if (response.diceRequest) {
        gameState.waitingForDice = true;
        gameState.currentDiceRequest = response.diceRequest;
        await addStoryText('');
        await addStoryText(`${response.diceRequest.description}`);
        await addStoryText(`(${response.diceRequest.type} 주사위를 굴려주세요. 1부터 ${response.diceRequest.type.replace('D', '')} 사이의 숫자를 입력해주세요)`);
    } else {
        gameState.waitingForDice = false;
        gameState.currentDiceRequest = null;
    }
    
    // 게임 종료 처리
    if (response.gameEnded) {
        gameState.gameEnded = true;
        setTimeout(() => {
            calculateAlignmentAndShowResult();
        }, 2000);
    } else {
        // AI 응답 완료 후 입력창 표시
        showInputField();
    }
}

// ============================================
// 입력창 표시 함수
// ============================================
function showInputField() {
    const currentFrame = gameState.currentPageFrame;
    if (!currentFrame) return;
    
    const inputContainer = currentFrame.querySelector('.game-action-input-container');
    if (inputContainer) {
        inputContainer.style.display = 'flex';
        const input = inputContainer.querySelector('#actionInput');
        if (input) {
            input.focus();
        }
    }
}

// ============================================
// 플레이어 행동 처리
// ============================================
async function processPlayerAction(action) {
    // 플레이어 액션 저장 (점수 계산용)
    gameState.lastPlayerAction = action;
    
    // 게임이 끝났으면 처리하지 않음
    if (gameState.gameEnded) {
        return;
    }
    
    // 현재 페이지의 입력 필드를 텍스트로 변환 (하단에 유저 입력 표시)
    convertInputToText(action);
    
    // 페이지 전환 수행 (유저 입력이 하단에 표시된 상태로 슬라이드 아웃)
    gameState.needsPageTransition = true;
    await performPageTransition();
    
    // 주사위 굴림 대기 중이면 주사위 결과 처리
    if (gameState.waitingForDice) {
        await handleDiceRoll(action);
        return;
    }
    
    // AI에게 플레이어 행동 전달
    try {
        const userMessage = `플레이어의 행동: "${action}"`;
        
        // 유저 입력 DB 저장
        await saveConversationLog(gameState.sessionId, 'user', action);
        
        const response = await callOpenAIAPI(userMessage);
        
        // AI 응답 저장 (점수 계산용)
        gameState.lastAIResponse = response;
        
        // AI 응답 DB 저장
        await saveConversationLog(gameState.sessionId, 'assistant', response.story || JSON.stringify(response));
        
        // 대화 히스토리에 추가
        addToConversationHistory(userMessage, response);
        
        // 응답 처리 (새 페이지에 AI 응답만 출력)
        await processAIResponseWithoutTransition(response);
    } catch (error) {
        await addStoryText(`오류가 발생했습니다: ${error.message}`);
    }
}

// ============================================
// 입력 필드를 텍스트로 변환 (피그마 디자인 기준)
// ============================================
function convertInputToText(action) {
    const currentFrame = gameState.currentPageFrame;
    if (!currentFrame) return;
    
    const inputContainer = currentFrame.querySelector('.game-action-input-container');
    if (!inputContainer) return;
    
    // 입력 필드를 텍스트로 교체
    inputContainer.innerHTML = `
        <p class="user-action-text font-['BookkGothic',sans-serif] text-[16px] text-[#0f100f] tracking-[-0.24px] leading-[1.5] w-full">
            ${action}
        </p>
    `;
}

// ============================================
// 주사위 굴림 처리
// ============================================
async function handleDiceRoll(input) {
    const num = parseInt(input);
    const diceType = gameState.currentDiceRequest?.type;
    
    if (isNaN(num)) {
        await addStoryText('숫자를 입력해주세요.');
        return;
    }
    
    // 주사위 범위 확인
    const maxValue = parseInt(diceType?.replace('D', '') || '20');
    if (isNaN(maxValue) || maxValue <= 0) {
        await addStoryText('주사위 타입이 올바르지 않습니다.');
        return;
    }
    if (num < 1 || num > maxValue) {
        await addStoryText(`1부터 ${maxValue} 사이의 숫자를 입력해주세요.`);
        return;
    }
    
    // 주사위 결과는 AI가 스토리에서 자연스럽게 설명함
    gameState.waitingForDice = false;
    
    // AI에게 주사위 결과 전달 (다음 단계로 자동 진행 요청 포함)
    try {
        const userMessage = `주사위 굴림 결과: ${num} (${diceType}). 주사위 결과를 제시한 후, 반드시 다음 단계로 자동으로 진행하세요. 플레이어의 추가 입력을 기다리지 말고 시나리오를 계속 진행하세요.`;
        
        // 주사위 결과 DB 저장
        await saveConversationLog(gameState.sessionId, 'user', `주사위 굴림: ${num} (${diceType})`);
        
        const response = await callOpenAIAPI(userMessage);
        
        // AI 응답 저장 (점수 계산용)
        gameState.lastAIResponse = response;
        
        // AI 응답 DB 저장
        await saveConversationLog(gameState.sessionId, 'assistant', response.story || JSON.stringify(response));
        
        // 대화 히스토리에 추가
        addToConversationHistory(userMessage, response);
        
        // 응답 처리 (새 페이지에 AI 응답 출력)
        await processAIResponseWithoutTransition(response);
    } catch (error) {
        await addStoryText(`오류가 발생했습니다: ${error.message}`);
    }
}

// ============================================
// 클라이언트 측 점수 계산 (백업 로직) - 균형 조정됨
// ============================================
function calculateClientSideScore(story, playerAction) {
    if (!playerAction) return;
    
    const action = playerAction.toLowerCase();
    let scores = { lawful: 0, chaotic: 0, good: 0, evil: 0 };
    
    // 강한 Lawful 키워드 (+2)
    const lawfulStrongKeywords = [
        '경찰', '신고', '신분증', '계약', '규칙', '법', '절차', '서류', '문서'
    ];
    // 약한 Lawful 키워드 (+1)
    const lawfulWeakKeywords = [
        '확인', '조심', '신중', '살펴', '검사', '점검', '파악', '차분', '질문'
    ];
    
    // 강한 Chaotic 키워드 (+2)
    const chaoticStrongKeywords = [
        '같이 가', '배달 가', '구슬 써', '산타가 되', '마음대로', '던져', '차버', '돌려차'
    ];
    // 약한 Chaotic 키워드 (+1)
    const chaoticWeakKeywords = [
        '즉시', '당장', '지금', '바로', '그냥', '훅', '즉흥', '갑자기', '일단'
    ];
    
    // 강한 Good 키워드 (+2)
    const goodStrongKeywords = [
        '돌려줄게', '가져가', '도와줄', '필요없어', '공짜로', '그냥 줄게'
    ];
    // 약한 Good 키워드 (+1)
    const goodWeakKeywords = [
        '걱정', '괜찮', '힘내', '위로', '응원', '안심', '불쌍', '딱하'
    ];
    
    // 강한 Evil 키워드 (+2)
    const evilStrongKeywords = [
        '협박', '훔쳐', '강탈', '빼앗', '안 줄', '내놔', '힘으로'
    ];
    // 약한 Evil 키워드 (+1)
    const evilWeakKeywords = [
        '쿠폰 더', '더 내놔', '돈 더', '무시', '관심없', '싫', '귀찮', '짜증'
    ];
    
    // 중립 키워드 (양쪽 축 0점 유지)
    const neutralKeywords = [
        '거래', '교환', '공정', '모르겠', '생각해', '잠깐', '일단 보자', '상황 파악'
    ];
    
    function matchKeywords(keywords) {
        return keywords.some(keyword => action.includes(keyword));
    }
    
    function countMatches(keywords) {
        return keywords.filter(keyword => action.includes(keyword)).length;
    }
    
    // 중립 키워드가 있으면 점수 부여 안 함
    if (matchKeywords(neutralKeywords)) {
        console.log('중립 키워드 감지 - 점수 변동 없음');
        return;
    }
    
    // Lawful 점수
    if (matchKeywords(lawfulStrongKeywords)) {
        scores.lawful += 2;
    } else if (matchKeywords(lawfulWeakKeywords)) {
        scores.lawful += 1;
    }
    
    // Chaotic 점수
    if (matchKeywords(chaoticStrongKeywords)) {
        scores.chaotic += 2;
    } else if (matchKeywords(chaoticWeakKeywords)) {
        scores.chaotic += 1;
    }
    
    // Good 점수 (기존 +3에서 +2로 균형 조정)
    if (matchKeywords(goodStrongKeywords)) {
        scores.good += 2;
    } else if (matchKeywords(goodWeakKeywords)) {
        scores.good += 1;
    }
    
    // Evil 점수
    if (matchKeywords(evilStrongKeywords)) {
        scores.evil += 2;
    } else if (matchKeywords(evilWeakKeywords)) {
        scores.evil += 1;
    }
    
    const hasAIScore = gameState.lastAIResponse?.alignmentScores && 
                       (gameState.lastAIResponse.alignmentScores.lawful !== 0 ||
                        gameState.lastAIResponse.alignmentScores.chaotic !== 0 ||
                        gameState.lastAIResponse.alignmentScores.good !== 0 ||
                        gameState.lastAIResponse.alignmentScores.evil !== 0);
    
    if (!hasAIScore && (scores.lawful !== 0 || scores.chaotic !== 0 || scores.good !== 0 || scores.evil !== 0)) {
        applyAlignmentDelta(scores, 'client-fallback');
        console.log('클라이언트 측 점수 계산:', scores);
    }
}

// ============================================
// 최종 성향 계산 및 결과 표시 - 균형 개선됨
// ============================================
async function calculateAlignmentAndShowResult() {
    const scores = gameState.alignmentScores;
    
    console.log('최종 점수:', scores);
    
    // 질서-혼돈 축 결정 (더 세밀한 판정)
    let axis1 = 'Neutral';
    const lawChaosDiff = scores.lawful - scores.chaotic;
    const lawChaosTotal = scores.lawful + scores.chaotic;
    
    // 차이가 2 이상이고, 우세한 쪽이 최소 2점 이상일 때
    if (lawChaosDiff >= 2 && scores.lawful >= 2) {
        axis1 = 'Lawful';
    } else if (lawChaosDiff <= -2 && scores.chaotic >= 2) {
        axis1 = 'Chaotic';
    }
    // 차이가 크면 (4 이상) 확실히 결정
    else if (lawChaosDiff >= 4) {
        axis1 = 'Lawful';
    } else if (lawChaosDiff <= -4) {
        axis1 = 'Chaotic';
    }
    // 둘 다 높지만 비슷하면 Neutral 유지
    
    // 선-악 축 결정 (더 세밀한 판정)
    let axis2 = 'Neutral';
    const goodEvilDiff = scores.good - scores.evil;
    const goodEvilTotal = scores.good + scores.evil;
    
    // 차이가 2 이상이고, 우세한 쪽이 최소 2점 이상일 때
    if (goodEvilDiff >= 2 && scores.good >= 2) {
        axis2 = 'Good';
    } else if (goodEvilDiff <= -2 && scores.evil >= 2) {
        axis2 = 'Evil';
    }
    // 차이가 크면 (4 이상) 확실히 결정
    else if (goodEvilDiff >= 4) {
        axis2 = 'Good';
    } else if (goodEvilDiff <= -4) {
        axis2 = 'Evil';
    }
    // 둘 다 높지만 비슷하면 Neutral 유지
    
    // True Neutral 처리
    if (axis1 === 'Neutral' && axis2 === 'Neutral') {
        axis2 = ''; // True Neutral
    }
    
    const finalAlignment = axis2 ? `${axis1} ${axis2}` : (axis1 === 'Neutral' ? 'True Neutral' : axis1 + ' Neutral');
    
    console.log('성향 판정 상세:', {
        lawChaosDiff,
        goodEvilDiff,
        axis1,
        axis2,
        finalAlignment
    });
    
    console.log('최종 성향:', finalAlignment);
    
    // DB에 세션 완료 저장
    await completeGameSession(gameState.sessionId, finalAlignment, scores);
    
    // AI에게 에필로그 생성 요청
    try {
        const epilogue = await generateEpilogue(finalAlignment, scores);
        showResult(finalAlignment, epilogue);
    } catch (error) {
        console.error('에필로그 생성 실패:', error);
        // 실패 시 기본 에필로그 사용
        const defaultEpilogue = {
            title: finalAlignment.replace(' ', '\n'),
            description: `당신의 D&D 성향은 ${finalAlignment}입니다.`
        };
        showResult(finalAlignment, defaultEpilogue);
    }
}

// ============================================
// AI로 에필로그 생성
// ============================================
async function generateEpilogue(alignment, scores) {
    // 플레이어의 주요 선택 추출 (대화 히스토리에서)
    const playerActions = gameState.conversationHistory
        .filter(msg => msg.role === 'user')
        .slice(-5) // 최근 5개 행동만
        .map(msg => msg.content)
        .join('\n');
    
    const epiloguePrompt = `게임이 끝났습니다. 플레이어의 최종 D&D 성향은 "${alignment}"입니다.

플레이어의 주요 선택들:
${playerActions}

성향 점수:
- Lawful: ${scores.lawful}, Chaotic: ${scores.chaotic}
- Good: ${scores.good}, Evil: ${scores.evil}

위 정보를 바탕으로, 플레이어의 선택에 따른 간단한 한 문단 에필로그를 작성해주세요.

요구사항:
1. 한 문단으로 간결하게 작성 (3-5문장)
2. 플레이어의 선택에 따른 자연스러운 결과를 묘사
3. "당신의 D&D 성향은..." 같은 메타 설명은 제외
4. 스토리텔링 형식으로 작성 (예: "다음날 아침, 문 앞에..." 같은 구체적인 묘사)

다음 JSON 형식으로 응답하세요:
{
  "title": "성향 이름 (예: Lawful\\nGood)",
  "description": "에필로그 텍스트 (한 문단)"
}`;

    try {
        const response = await callOpenAIAPI(epiloguePrompt, '당신은 TRPG 게임의 에필로그 작가입니다. 플레이어의 선택에 따른 자연스럽고 간결한 에필로그를 작성합니다. 반드시 JSON 형식으로 응답하세요.');
        
        // 응답 파싱 (callOpenAIAPI는 이미 JSON을 파싱해서 반환)
        if (response.title && response.description) {
            return {
                title: response.title,
                description: response.description
            };
        } else {
            throw new Error('Invalid response format: missing title or description');
        }
    } catch (error) {
        console.error('에필로그 생성 오류:', error);
        // 실패 시 기본 에필로그 반환
        return {
            title: alignment.toLowerCase().replace(' ', '\n'),
            description: `당신의 선택에 따라 이야기가 끝났습니다. 당신의 D&D 성향은 ${alignment}입니다.`
        };
    }
}

// ============================================
// 성향 이름을 SVG 파일명으로 변환
// ============================================
function getAlignmentSVGPath(alignment) {
    const normalized = (alignment || '').toLowerCase().trim();
    const svgMap = {
        'lawful good': 'lawful good.svg',
        'neutral good': 'neutral good.svg',
        'chaotic good': 'chaotic good.svg',
        'lawful neutral': 'lawful neutral.svg',
        'true neutral': 'true neutral.svg',
        'chaotic neutral': 'chaotic neutral.svg',
        'lawful evil': 'lawful evil.svg',
        'neutral evil': 'neutral evil.svg',
        'chaotic evil': 'chaotic evil.svg'
    };
    
    const fileName = svgMap[normalized] || 'true neutral.svg';
    const encodedFileName = fileName.replace(/ /g, '%20');
    const path = `assets/${encodedFileName}`;
    
    console.log('getAlignmentSVGPath:', { alignment, normalized, fileName, encodedFileName, path });
    
    return path;
}

// ============================================
// 결과 페이지로 이동
// ============================================
async function showResult(alignment, epilogue) {
    const resultTitle = document.getElementById('resultTitle');
    const resultDescription = document.getElementById('resultDescription');
    
    if (!resultTitle || !resultDescription || !epilogue) {
        console.error('Result page elements not found or epilogue is missing');
        return;
    }
    
    const normalizedAlignment = (alignment || '').toLowerCase();
    const rawTitle = (epilogue.title && epilogue.title.trim().length > 0)
        ? epilogue.title.toLowerCase()
        : normalizedAlignment;
    const fallbackTitle = (rawTitle && rawTitle.length > 0) ? rawTitle : 'true neutral';
    
    if (fallbackTitle.includes('\n')) {
        resultTitle.innerHTML = fallbackTitle.replace(/\n/g, '<br>');
    } else {
        const titleForDisplay = fallbackTitle.replace(/\s+/g, ' ').trim();
        const titleParts = titleForDisplay.split(' ');
        if (titleParts.length >= 2) {
            resultTitle.innerHTML = `${titleParts[0]}<br>${titleParts.slice(1).join(' ')}`;
        } else {
            resultTitle.textContent = titleForDisplay;
        }
    }
    
    // 설명 텍스트 설정 (피그마 디자인: 간단하게 한 문단으로)
    // epilogue.description을 그대로 표시 (한 문단)
    resultDescription.innerHTML = `<p>${epilogue.description.trim()}</p>`;
    
    // 성향별 SVG 이미지 표시 (피그마 디자인: result-image-container에 삽입)
    const resultImageContainer = document.querySelector('.result-image-container');
    if (resultImageContainer) {
        console.log('result-image-container found, alignment:', alignment);
        
        // 컨테이너 크기 직접 설정 (2배)
        resultImageContainer.style.width = '240px';
        resultImageContainer.style.height = '174px';
        
        // 기존 내용 제거
        resultImageContainer.innerHTML = '';
        
        // SVG 이미지 추가
        const img = document.createElement('img');
        const imagePath = getAlignmentSVGPath(normalizedAlignment);
        console.log('Image path:', imagePath);
        
        img.src = imagePath;
        img.alt = normalizedAlignment || 'alignment result';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'contain';
        img.style.display = 'block';
        
        // 이미지 로드 에러 처리
        img.onerror = function() {
            console.error('이미지 로드 실패:', imagePath);
            this.style.display = 'none';
        };
        
        // 이미지 로드 성공 확인
        img.onload = function() {
            console.log('이미지 로드 성공:', imagePath);
        };
        
        resultImageContainer.appendChild(img);
    } else {
        console.error('result-image-container를 찾을 수 없습니다!');
    }
    
    showPage('result');
    
    // 방명록 불러오기
    await displayGuestbook();
}

// ============================================
// 방명록 UI 함수들
// ============================================

// 방명록 표시
async function displayGuestbook() {
    const guestbookList = document.getElementById('guestbookList');
    if (!guestbookList) return;
    
    // 로딩 표시
    guestbookList.innerHTML = '<p class="guestbook-loading">방명록을 불러오는 중...</p>';
    
    const entries = await loadGuestbookEntries(20);
    
    if (entries.length === 0) {
        guestbookList.innerHTML = '<p class="guestbook-empty">아직 방명록이 없습니다. 첫 번째로 남겨보세요!</p>';
        return;
    }
    
    guestbookList.innerHTML = entries.map(entry => `
        <div class="guestbook-entry">
            <div class="guestbook-entry-header">
                <span class="guestbook-nickname">${escapeHtml(entry.nickname)}</span>
                <span class="guestbook-alignment">${entry.alignment || ''}</span>
            </div>
            <p class="guestbook-message">${escapeHtml(entry.message)}</p>
            <span class="guestbook-date">${formatDate(entry.created_at)}</span>
        </div>
    `).join('');
}

// 방명록 작성 처리
// 방명록 접기/펼치기 토글
function toggleGuestbook() {
    const body = document.getElementById('guestbookBody');
    const toggle = document.getElementById('guestbookToggle');
    
    if (!body || !toggle) return;
    
    if (body.classList.contains('collapsed')) {
        body.classList.remove('collapsed');
        toggle.classList.add('expanded');
    } else {
        body.classList.add('collapsed');
        toggle.classList.remove('expanded');
    }
}

async function submitGuestbook() {
    const nicknameInput = document.getElementById('guestbookNickname');
    const emailInput = document.getElementById('guestbookEmail');
    const messageInput = document.getElementById('guestbookMessage');
    const submitBtn = document.getElementById('guestbookSubmitBtn');
    
    if (!nicknameInput || !messageInput) return;
    
    const nickname = nicknameInput.value.trim();
    const email = emailInput ? emailInput.value.trim() : '';
    const message = messageInput.value.trim();
    
    if (!nickname) {
        alert('닉네임을 입력해주세요.');
        nicknameInput.focus();
        return;
    }
    
    if (!message) {
        alert('메시지를 입력해주세요.');
        messageInput.focus();
        return;
    }
    
    // 버튼 비활성화
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '저장 중...';
    }
    
    // 현재 결과 페이지의 성향 가져오기
    const resultTitle = document.getElementById('resultTitle');
    const alignment = resultTitle ? resultTitle.textContent.replace(/\n/g, ' ').trim() : '';
    
    const result = await saveGuestbookEntry(
        gameState.sessionId,
        nickname,
        email,
        message,
        alignment
    );
    
    if (result) {
        // 입력 필드 초기화
        nicknameInput.value = '';
        if (emailInput) emailInput.value = '';
        messageInput.value = '';
        
        // 방명록 새로고침
        await displayGuestbook();
        
        alert('방명록이 등록되었습니다!');
    } else {
        alert('방명록 저장에 실패했습니다. 다시 시도해주세요.');
    }
    
    // 버튼 다시 활성화
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '남기기';
    }
}

// HTML 이스케이프 함수
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 날짜 포맷 함수
function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    
    // 1시간 이내
    if (diff < 3600000) {
        const minutes = Math.floor(diff / 60000);
        return minutes <= 0 ? '방금 전' : `${minutes}분 전`;
    }
    
    // 24시간 이내
    if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `${hours}시간 전`;
    }
    
    // 그 외
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
}

// ============================================
// 행동 입력 처리
// ============================================
function handleActionInput(event) {
    if (event.key === 'Enter') {
        const input = event.target;
        const action = input.value.trim();
        
        if (!action) return;
        
        // 플레이어 행동 처리
        gameActions.push(action);
        input.value = '';
        processPlayerAction(action);
    }
}

// ============================================
// 스토리 출력 업데이트 (마크다운 지원 + 타이핑 애니메이션)
// ============================================
async function addStoryText(text, isPlayerAction = false) {
    // 현재 스토리 출력 영역 찾기
    const output = gameState.currentStoryOutput || document.querySelector('.story-output');
    
    if (!output) {
        console.error('story-output not found');
        return;
    }
    
    if (isPlayerAction) {
        // 플레이어 액션 추가
        const newParagraph = document.createElement('p');
        newParagraph.textContent = `[${gameState.playerName}]: ${text}`;
        newParagraph.style.fontStyle = 'italic';
        newParagraph.style.color = '#4a5568';
        newParagraph.style.marginBottom = '0.5em';
        newParagraph.style.lineHeight = '1.6';
        newParagraph.style.wordWrap = 'break-word';
        newParagraph.style.wordBreak = 'keep-all';
        newParagraph.style.overflowWrap = 'break-word';
        output.appendChild(newParagraph);
        
        // 현재 페이지를 히스토리에 업데이트
        setTimeout(() => {
            if (output && output.innerHTML.trim() !== '') {
                const pageHtml = output.innerHTML;
                const pageData = {
                    storyHtml: pageHtml,
                    userActionHtml: '',
                    pageNumber: currentPageNumber
                };
                
                if (gameState.currentPageIndex >= 0 && gameState.currentPageIndex < gameState.pageHistory.length) {
                    gameState.pageHistory[gameState.currentPageIndex] = pageData;
                } else {
                    gameState.pageHistory.push(pageData);
                    gameState.currentPageIndex = gameState.pageHistory.length - 1;
                    updateNavigationButtons();
                }
            }
        }, 50);
        
        // 스크롤을 맨 아래로
        setTimeout(() => {
            if (output) {
                output.scrollTop = output.scrollHeight;
            }
        }, 10);
    } else {
        // 일반 AI 응답
        await addContentToContainer(output, text);
    }
}

// 컨테이너에 내용 추가하는 헬퍼 함수
async function addContentToContainer(container, text) {
    const output = gameState.currentStoryOutput || document.querySelector('.story-output');
    
    if (!text || text.trim() === '') {
        return;
    }
    
    // AI 응답은 타이핑 애니메이션 적용
    if (typeof marked !== 'undefined') {
        // marked.js 옵션 설정
        marked.setOptions({
            breaks: true, // 줄바꿈을 <br>로 변환
            gfm: true, // GitHub Flavored Markdown 활성화
            headerIds: false, // 헤더 ID 생성 비활성화
            mangle: false // 이메일 주소 난독화 비활성화
        });
        
        // 마크다운을 HTML로 변환
        const html = marked.parse(text);
        
        // HTML을 임시 div에 넣어서 파싱
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        // 각 요소를 개별 처리
        const children = Array.from(tempDiv.children);
        
        if (children.length === 0) {
            // 자식 요소가 없으면 (텍스트만 있으면) p 태그로 감싸기
            const newParagraph = document.createElement('p');
            newParagraph.style.marginBottom = '0.5em';
            newParagraph.style.lineHeight = '1.6';
            newParagraph.style.wordWrap = 'break-word';
            newParagraph.style.wordBreak = 'keep-all';
            newParagraph.style.overflowWrap = 'break-word';
            container.appendChild(newParagraph);
            
            // 타이핑 애니메이션 적용
            await typeText(newParagraph, html, true);
        } else {
            // 자식 요소가 있으면 각각 처리
            for (const child of children) {
                const newElement = child.cloneNode(true);
                newElement.style.marginBottom = '0.5em';
                newElement.style.lineHeight = '1.6';
                newElement.style.wordWrap = 'break-word';
                newElement.style.wordBreak = 'keep-all';
                newElement.style.overflowWrap = 'break-word';
                
                // 내용을 비우고 추가
                const content = newElement.innerHTML;
                newElement.innerHTML = '';
                container.appendChild(newElement);
                
                // 타이핑 애니메이션 적용
                await typeText(newElement, content, true);
            }
        }
    } else {
        // marked.js가 없으면 일반 텍스트로 표시
        const newParagraph = document.createElement('p');
        newParagraph.style.marginBottom = '0.5em';
        newParagraph.style.lineHeight = '1.6';
        newParagraph.style.wordWrap = 'break-word';
        newParagraph.style.wordBreak = 'keep-all';
        newParagraph.style.overflowWrap = 'break-word';
        container.appendChild(newParagraph);
        
        // 타이핑 애니메이션 적용
        await typeText(newParagraph, text, false);
    }
    
    // 스크롤을 맨 아래로
    setTimeout(() => {
        if (output) {
            output.scrollTop = output.scrollHeight;
        }
    }, 10);
    
    // 현재 페이지를 히스토리에 업데이트 (타이핑 애니메이션 완료 후)
    setTimeout(() => {
        if (container && container.innerHTML.trim() !== '') {
            const pageHtml = container.innerHTML;
            const pageData = {
                storyHtml: pageHtml,
                userActionHtml: '',
                pageNumber: currentPageNumber
            };
            
            if (gameState.currentPageIndex >= 0 && gameState.currentPageIndex < gameState.pageHistory.length) {
                // 이미 존재하는 페이지면 업데이트
                gameState.pageHistory[gameState.currentPageIndex] = pageData;
            } else if (gameState.currentPageIndex === -1) {
                // 첫 페이지가 아직 히스토리에 없으면 추가
                gameState.pageHistory.push(pageData);
                gameState.currentPageIndex = 0;
                updateNavigationButtons();
            }
        }
    }, 100);
}

// 타이핑 애니메이션 함수
async function typeText(element, content, isHTML = false) {
    return new Promise((resolve) => {
        if (!content || content.trim() === '') {
            resolve();
            return;
        }
        
        const speed = 15; // 타이핑 속도 (밀리초)
        
        if (isHTML) {
            // HTML인 경우: 태그는 즉시 추가, 텍스트만 한 글자씩
            let currentPos = 0;
            let currentHTML = '';
            
            function typeNext() {
                // 페이지 전환 체크: 요소가 DOM에서 사라졌거나, 현재 페이지 프레임이 아닌 경우 중단
                if (!element.isConnected || (gameState.currentPageFrame && element.closest('.game-page-frame') !== gameState.currentPageFrame)) {
                    resolve();
                    return;
                }

                if (currentPos >= content.length) {
                    // 마크다운 스타일 적용
                    applyMarkdownStyles(element);
                    resolve();
                    return;
                }
                
                // 현재 위치가 태그 안인지 확인
                if (content[currentPos] === '<') {
                    // 태그 전체를 찾아서 한 번에 추가
                    const tagEnd = content.indexOf('>', currentPos);
                    if (tagEnd !== -1) {
                        currentHTML += content.substring(currentPos, tagEnd + 1);
                        element.innerHTML = currentHTML;
                        currentPos = tagEnd + 1;
                        setTimeout(typeNext, speed * 0.3); // 태그는 빠르게
                    } else {
                        // 태그가 제대로 닫히지 않음, 나머지 모두 추가
                        currentHTML += content.substring(currentPos);
                        element.innerHTML = currentHTML;
                        applyMarkdownStyles(element);
                        resolve();
                    }
                } else {
                    // 텍스트는 한 글자씩 추가
                    currentHTML += content[currentPos];
                    element.innerHTML = currentHTML;
                    currentPos++;
                    setTimeout(typeNext, speed);
                }
                
                // 스크롤을 맨 아래로 (현재 페이지인 경우만)
                const output = gameState.currentStoryOutput;
                if (output && output.contains(element)) {
                    output.scrollTop = output.scrollHeight;
                }
            }
            
            typeNext();
        } else {
            // 일반 텍스트는 한 글자씩
            let index = 0;
            
            function typeNext() {
                // 페이지 전환 체크: 요소가 DOM에서 사라졌거나, 현재 페이지 프레임이 아닌 경우 중단
                if (!element.isConnected || (gameState.currentPageFrame && element.closest('.game-page-frame') !== gameState.currentPageFrame)) {
                    resolve();
                    return;
                }

                if (index >= content.length) {
                    resolve();
                    return;
                }
                
                element.textContent = content.substring(0, index + 1);
                index++;
                setTimeout(typeNext, speed);
                
                // 스크롤을 맨 아래로 (현재 페이지인 경우만)
                const output = gameState.currentStoryOutput;
                if (output && output.contains(element)) {
                    output.scrollTop = output.scrollHeight;
                }
            }
            
            typeNext();
        }
    });
}

// 마크다운 스타일 적용
function applyMarkdownStyles(element) {
    // 굵게
    element.querySelectorAll('strong, b').forEach(el => {
        el.style.fontWeight = '700';
    });
    
    // 기울임
    element.querySelectorAll('em, i').forEach(el => {
        el.style.fontStyle = 'italic';
    });
    
    // 인라인 코드
    element.querySelectorAll('code:not(pre code)').forEach(el => {
        el.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
        el.style.padding = '2px 4px';
        el.style.borderRadius = '3px';
        el.style.fontFamily = 'monospace';
        el.style.fontSize = '0.9em';
    });
    
    // 코드 블록
    element.querySelectorAll('pre code').forEach(el => {
        el.style.display = 'block';
        el.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
        el.style.padding = '8px';
        el.style.borderRadius = '4px';
        el.style.fontFamily = 'monospace';
        el.style.fontSize = '0.9em';
        el.style.overflowX = 'auto';
    });
    
    // 리스트
    element.querySelectorAll('ul, ol').forEach(el => {
        el.style.marginLeft = '1.5em';
        el.style.marginTop = '0.5em';
        el.style.marginBottom = '0.5em';
        el.style.paddingLeft = '1em';
    });
    
    // 리스트 아이템
    element.querySelectorAll('li').forEach(el => {
        el.style.marginBottom = '0.25em';
    });
    
    // 인용구
    element.querySelectorAll('blockquote').forEach(el => {
        el.style.borderLeft = '3px solid rgba(0, 0, 0, 0.2)';
        el.style.paddingLeft = '1em';
        el.style.marginLeft = '0';
        el.style.color = '#4a5568';
        el.style.fontStyle = 'italic';
    });
    
    // 수평선
    element.querySelectorAll('hr').forEach(el => {
        el.style.border = 'none';
        el.style.borderTop = '1px solid rgba(0, 0, 0, 0.1)';
        el.style.margin = '1em 0';
    });
}

// ============================================
// 다음/이전 페이지
// ============================================
function nextPage() {
    if (currentPage !== 'game') return;
    
    // 다음 페이지가 있는지 확인
    if (gameState.currentPageIndex < gameState.pageHistory.length - 1) {
        gameState.currentPageIndex++;
        loadPageFromHistory(gameState.currentPageIndex);
    }
}

function previousPage() {
    if (currentPage !== 'game') return;
    
    // 이전 페이지가 있는지 확인
    if (gameState.currentPageIndex > 0) {
        gameState.currentPageIndex--;
        loadPageFromHistory(gameState.currentPageIndex);
    }
}

// 히스토리에서 페이지 로드
function loadPageFromHistory(pageIndex) {
    const frameContainer = document.getElementById('gameFrameContainer');
    if (!frameContainer) return;
    
    // 유효성 검사
    if (pageIndex < 0 || pageIndex >= gameState.pageHistory.length) {
        console.error('Invalid page index:', pageIndex);
        return;
    }
    
    const pageData = gameState.pageHistory[pageIndex];
    if (!pageData) {
        console.error('Page data not found at index:', pageIndex);
        return;
    }
    
    // 현재 페이지를 히스토리에 저장 (현재 페이지가 마지막 페이지인 경우)
    if (gameState.currentPageFrame && 
        gameState.currentPageIndex === gameState.pageHistory.length - 1 &&
        gameState.currentPageIndex >= 0) {
        const storyOutput = gameState.currentPageFrame.querySelector('.story-output');
        const inputContainer = gameState.currentPageFrame.querySelector('.game-action-input-container');
        
        let userActionHtml = '';
        const userActionText = inputContainer?.querySelector('.user-action-text');
        if (userActionText) {
            userActionHtml = inputContainer.innerHTML;
        }
        
        gameState.pageHistory[gameState.currentPageIndex] = {
            storyHtml: storyOutput ? storyOutput.innerHTML : '',
            userActionHtml: userActionHtml,
            pageNumber: currentPageNumber
        };
    }
    
    // 페이지 번호 업데이트
    currentPageNumber = pageData.pageNumber;
    
    // 현재 프레임의 내용 업데이트
    if (gameState.currentStoryOutput) {
        // 구버전 호환 (html 필드가 있는 경우)
        if (pageData.html !== undefined) {
            gameState.currentStoryOutput.innerHTML = pageData.html;
        } else {
            gameState.currentStoryOutput.innerHTML = pageData.storyHtml || '';
        }
    }
    
    // 유저 액션 영역 업데이트
    const inputContainer = gameState.currentPageFrame?.querySelector('.game-action-input-container');
    if (inputContainer) {
        if (pageData.userActionHtml) {
            inputContainer.innerHTML = pageData.userActionHtml;
            inputContainer.style.display = 'flex';
        } else {
            // 유저 액션이 없으면 입력 필드 표시 (마지막 페이지인 경우)
            if (pageIndex === gameState.pageHistory.length - 1) {
                inputContainer.innerHTML = `
                    <input 
                        type="text" 
                        id="actionInput" 
                        placeholder="행동을 자유롭게 입력하고 Enter를 누르세요..." 
                        class="game-action-input"
                        onkeypress="handleActionInput(event)"
                    >
                `;
                inputContainer.style.display = 'flex';
            } else {
                inputContainer.style.display = 'none';
            }
        }
    }
    
    // 화살표 버튼 상태 업데이트
    updateNavigationButtons();
    
    // 스크롤을 맨 아래로
    setTimeout(() => {
        if (gameState.currentStoryOutput) {
            gameState.currentStoryOutput.scrollTop = gameState.currentStoryOutput.scrollHeight;
        }
    }, 10);
}

// 화살표 버튼 활성화/비활성화 업데이트
function updateNavigationButtons() {
    const prevButton = document.querySelector('.game-nav-arrow-left');
    const nextButton = document.querySelector('.game-nav-arrow-right');
    
    if (prevButton) {
        if (gameState.currentPageIndex > 0) {
            prevButton.style.opacity = '1';
            prevButton.style.pointerEvents = 'auto';
        } else {
            prevButton.style.opacity = '0.3';
            prevButton.style.pointerEvents = 'auto'; // 클릭은 가능하지만 비활성화된 것처럼 보임
        }
    }
    
    if (nextButton) {
        if (gameState.currentPageIndex < gameState.pageHistory.length - 1) {
            nextButton.style.opacity = '1';
            nextButton.style.pointerEvents = 'auto';
        } else {
            nextButton.style.opacity = '0.3';
            nextButton.style.pointerEvents = 'auto';
        }
    }
}

// ============================================
// 홈으로 돌아가기
// ============================================
function goToHome() {
    showPage('home');
    const userNameInput = document.getElementById('userName');
    if (userNameInput) {
        userNameInput.value = '';
    }
    const actionInput = document.getElementById('actionInput');
    if (actionInput) {
        actionInput.value = '';
    }
    gameActions = [];
    currentPageNumber = 1;
    
    // 중복 실행 방지 플래그 리셋 (다음 게임을 위해)
    isGameStarting = false;
    isGameInitializing = false;
    isPrologueDisplayed = false;
    
    // 게임 상태 초기화
    if (gameState) {
        gameState.currentPageFrame = null;
        gameState.currentStoryOutput = null;
        gameState.needsPageTransition = false;
    }
    
    // 게임 프레임 컨테이너 리셋 (다음 게임을 위해, 피그마 레이아웃)
    const frameContainer = document.getElementById('gameFrameContainer');
    if (frameContainer) {
        frameContainer.innerHTML = `
            <div class="game-page-frame" id="currentPageFrame">
                <div class="bg-white game-page-container">
                    <div class="story-output font-hahmlet text-base text-[#0f100f] overflow-y-auto game-story-output"></div>
                    <div class="game-action-input-container" style="display: none;">
                        <input 
                            type="text" 
                            id="actionInput" 
                            placeholder="행동을 자유롭게 입력하고 Enter를 누르세요..." 
                            class="game-action-input"
                            onkeypress="handleActionInput(event)"
                        >
                    </div>
                </div>
            </div>
        `;
    }
    
    toggleStartButton();
}

// ============================================
// 시작하기 버튼 표시/숨김 처리
// ============================================
function toggleStartButton() {
    const input = document.getElementById('userName');
    const button = document.getElementById('startButton');
    
    if (!input) {
        console.error('toggleStartButton: userName input not found');
        return;
    }
    
    if (!button) {
        console.error('toggleStartButton: startButton not found');
        return;
    }
    
    const hasValue = input.value.trim().length > 0;
    console.log('toggleStartButton: hasValue =', hasValue, '| input.value =', `"${input.value}"`);
    
    // 인라인 스타일로 직접 제어 (CSS보다 우선순위 높음)
    if (hasValue) {
        // 버튼 표시 - 클래스 토글만 사용
        button.classList.add('visible');
        console.log('toggleStartButton: 버튼 표시됨 - 클래스 적용');
    } else {
        // 버튼 숨김
        button.classList.remove('visible');
        console.log('toggleStartButton: 버튼 숨김됨 - 클래스 적용');
    }
}

// 전역 스코프에 함수 할당 (디버깅용)
window.toggleStartButton = toggleStartButton;

// ============================================
// 초기화
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    // 중복 초기화 방지
    if (isInitialized) {
        console.log('DOMContentLoaded: 이미 초기화됨 - 중복 호출 방지');
        return;
    }
    isInitialized = true;
    
    console.log('DOMContentLoaded: 초기화 시작');
    
    // Supabase 초기화 (에러가 나도 계속 진행)
    try {
        initSupabase();
    } catch (e) {
        console.log('Supabase 초기화 실패 (무시됨):', e);
    }
    
    // 버튼 존재 확인
    const startButton = document.getElementById('startButton');
    if (!startButton) {
        console.error('DOMContentLoaded: startButton을 찾을 수 없습니다!');
    } else {
        console.log('DOMContentLoaded: startButton 발견됨', startButton);
    }
    
    // input 필드 이벤트 리스너 설정
    const userNameInput = document.getElementById('userName');
    if (userNameInput) {
        console.log('DOMContentLoaded: userNameInput 발견됨');
        
        // 모든 입력 이벤트에 대해 버튼 상태 업데이트
        userNameInput.addEventListener('input', function(e) {
            console.log('Input event triggered, value:', e.target.value);
            toggleStartButton();
        });
        userNameInput.addEventListener('keyup', function(e) {
            console.log('Keyup event triggered, value:', e.target.value);
            toggleStartButton();
        });
        userNameInput.addEventListener('keydown', function(e) {
            console.log('Keydown event triggered, value:', e.target.value);
            toggleStartButton();
        });
        userNameInput.addEventListener('paste', function(e) {
            setTimeout(function() {
                console.log('Paste event triggered, value:', e.target.value);
                toggleStartButton();
            }, 10);
        });
        userNameInput.addEventListener('change', function(e) {
            console.log('Change event triggered, value:', e.target.value);
            toggleStartButton();
        });
        
        // 폭스 이벤트도 처리 (일부 브라우저)
        userNameInput.addEventListener('focus', function() {
            console.log('Focus event triggered');
        });
        userNameInput.addEventListener('blur', function(e) {
            console.log('Blur event triggered, value:', e.target.value);
            toggleStartButton();
        });
    } else {
        console.error('DOMContentLoaded: userName input element not found during initialization');
    }
    
    // 초기 버튼 상태 설정
    console.log('DOMContentLoaded: toggleStartButton 호출');
    if (userNameInput) {
        toggleStartButton();
        setTimeout(function() {
            try {
                userNameInput.focus();
            } catch (e) {
                console.log('Input focus failed (may be blocked by other elements)');
            }
        }, 100);
    }
    
    // [임시] Result 페이지 미리보기 시 방명록 로드
    const resultPage = document.getElementById('result');
    if (resultPage && resultPage.classList.contains('active')) {
        console.log('Result 페이지 미리보기 모드: 방명록 로드');
        displayGuestbook();
    }
    
    // startWebcamBackground(); // 웹캠 비활성화
});

// window.addEventListener('beforeunload', stopWebcamBackground);
