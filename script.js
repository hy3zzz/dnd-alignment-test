// ============================================
// 설정
// ============================================
const OPENAI_API_KEY = 'YOUR_OPENAI_API_KEY'; // API 키를 여기에 입력하거나 환경변수로 관리
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4.1-mini'; // 또는 'gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo' 등

// ============================================
// Supabase 설정
// ============================================
// Supabase 프로젝트 URL과 anon key를 여기에 입력하세요
// https://supabase.com/dashboard 에서 프로젝트 생성 후 확인 가능
const SUPABASE_URL = 'YOUR_SUPABASE_URL'; // 예: 'https://xxxxx.supabase.co'
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY'; // 예: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'

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
async function saveGuestbookEntry(sessionId, nickname, message, alignment) {
    if (!supabaseClient) {
        console.log('Supabase 미설정 - 방명록 저장 건너뜀');
        return null;
    }
    
    try {
        const { data, error } = await supabaseClient
            .from('guestbook')
            .insert([{
                session_id: sessionId,
                nickname: nickname,
                message: message,
                alignment: alignment
            }])
            .select()
            .single();
        
        if (error) throw error;
        console.log('방명록 저장 완료');
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

건조한 벨 소리가 고요한 공기를 가릅니다. 문을 열어보니, 복도의 센서등 아래 덩그러니 놓인 택배 상자가 보입니다. 발신인 란에 적힌 글자는 현실의 감각과는 다소 동떨어진 '북극 주식회사'.

당신이 조심스레 테이프를 뜯고 상자를 열자, 그 안에서 기묘한 사물들이 저마다의 존재감을 드러냅니다.

오래된 금박처럼 은은한 광택이 흐르는 황금색 쿠폰. 지나칠 정도로 명랑한 서체로 '축하합니다! 당첨되셨습니다!' 라고 적힌 화려한 편지. 그리고 북극이라는 이름이 무색하게도, 손에 쥐자마자 기이할 정도의 따스한 온기가 전해지는 붉은 구슬.

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

# 3. 플레이어 대응 원칙 (Flexibility & Rules)
*   **유연한 반응 (Improvisation)**: 플레이어가 시나리오에 없는 엉뚱한 행동(예: "쿠폰을 찢어버린다", "상자를 발로 찬다")을 하더라도 "그럴 수 없습니다"라고 거절하지 마십시오.
    *   그 행동에 대한 **현실적이고 문학적인 결과**를 묘사한 뒤, 자연스럽게 메인 스토리 줄기(청년과의 조우 등)로 다시 유도하십시오.
    *   예: 상자를 발로 찼다면 -> "상자가 둔탁한 소리를 내며 밀려납니다. 그 충격 때문일까요? 안에서 무언가 굴러가는 소리가 들립니다. 하지만 여전히..."
*   **스토리 흐름 유지**: 플레이어의 자유도는 존중하되, 정해진 5단계의 핵심 사건(청년 등장 -> 사정 청취 -> 진실 확인 -> 선택)은 반드시 거치도록 유도하세요.

# 4. 핵심 규칙 (절대 준수)

### [1] 출력 타이밍 통제 (Anti-Spoiler)
*   **CASE A: 주사위 굴리기 전 (Request State)**
    *   diceRequest가 null이 아닙니다.
    *   story에는 **판정을 위한 상황 묘사**와 **주사위 굴림 요청**만 적습니다. 절대 결과를 미리 말하지 마십시오.
*   **CASE B: 주사위 굴린 후 (Result State)**
    *   diceRequest는 null입니다.
    *   story에는 **[판정 결과 묘사]** + **[다음 단계 도입부]**를 이어서 적어 자연스럽게 장면을 전환하십시오.

### [2] 메타 설명 금지
*   "플레이어가 성공했습니다", "성향 점수가 올랐습니다" 같은 시스템 메시지를 story에 포함하지 마십시오. 오직 소설 속 문장만 출력하세요.

### [3] 미래 암시 금지
*   아직 일어나지 않은 사건을 예고하거나 "잠시 후", "곧", "반드시 일어날 것" 같은 표현으로 다음 전개를 알려주지 마십시오.
*   **story**에는 오직 현재 장면에서 플레이어가 체감하는 감각과 사건만 묘사하고, 새로운 사건은 실제로 발생하는 순간에만 서술하세요.

### [4] 인물 설정
*   등장인물: **박준호** (산타 인턴 7년차). 어설프지만 선한, 절박한 청년.

# 5. 응답 형식 (JSON Only)
다음 JSON 형식을 반드시 지키십시오:
{
  "story": "내레이션 텍스트 (마크다운 지원)",
  "alignmentScores": { "lawful": 0, "chaotic": 0, "good": 0, "evil": 0 },
  "diceRequest": { "type": "D20", "description": "판정명" } 또는 null,
  "gameEnded": false
}

# 6. 시나리오 상세 흐름 (Scenario Flow)

**단계 1: 프롤로그 (상자)**
- 플레이어가 “더 자세히 살펴본다 / 위화감을 느낀다 / 숨겨진 정보를 찾는다”라고 하면 **[판정 1] 관찰력 (D20)**을 제안하세요.  
  *성공(8+)*: 송장의 ‘주소 오류’ 메모, ‘VIP 긴급 배송’ 문구 등 디테일을 확인.  
  *실패*: 뚜렷한 단서는 못 찾지만 괜히 찝찝한 느낌만 남습니다.
- 판정을 하지 않더라도, 상자를 확인한 뒤에는 부드럽게 다음 장면으로 넘어갑니다.
- **자연스러운 연결 예시**  
  "그때였습니다. 쿵! 거실 발코니 쪽에서 둔탁한 소리가 울립니다. 창문 너머로 붉은 옷을 입은 누군가가 착지하고, 땀을 뻘뻘 흘린 청년이 창문을 두드립니다. “저기요! 문 좀 열어주시겠어요? 배송 실수가 났어요!”"

**단계 2: 청년과의 조우**
- 청년(박준호)은 반드시 발코니 이벤트 직후 등장합니다. 플레이어의 태도에 따라 청년의 말투나 몸짓을 변주하세요.
- 플레이어가 청년의 진실성을 가늠하려 하거나 표정을 읽으려 하면 **[판정 2] 통찰력 (D20)**을 제안할 수 있습니다.  
  *성공(8+)*: 낡은 사원증, ‘최종 경고장’, 떨리는 숨 같은 디테일을 제공.  
  *실패*: 진짜인지 연기인지 모호하지만, 다급함 자체는 느껴집니다.
- 청년은 **창밖 발코니에 있기 때문에 목소리가 유리에 막혀 잘 들리지 않습니다.** 플레이어가 창문을 조금 열거나, 가까이 다가가거나, 추가 질문을 해야만 대화가 명확해집니다.  
  이 설정을 활용해 플레이어가 자연스럽게 “뭐라고요?”, “조금만 더 크게 말해보세요” 등 상호작용을 하게 만들고, 그 과정에서 신뢰 여부를 판단할 시간도 벌어줍니다.
- 플레이어가 이 단계에서 바로 “택배를 돌려준다”거나 창문을 열어 구슬을 건네려 하면, **안전 확인·신분 증빙·문이 잠겨 있음** 등의 자연스러운 변주를 넣어 최소한 한 번 이상의 대화/판정을 거치도록 유도하세요.  
  예: “창문이 밖에서 잠겨 있어 바로 열 수 없다”, “정체를 묻지 않고 넘기긴 위험하다는 생각이 스친다” 같은 장치를 통해 단계 3으로 이어지게 합니다. 
- 판정을 하지 않아도, 플레이어가 문을 열고 대화를 이어가면 곧장 청년의 사정 설명으로 넘어갑니다.
- **매끄러운 내레이션 예시**  
  "청년은 창틀에 손을 괸 채 고개를 숙입니다. “죄송합니다... 저는 산타 인턴 7년 차 박준호라고 합니다. VIP 선물이 잘못 배송됐어요. 내일까지 못 찾으면 정말 해고당해요. 제발 도와주세요.”"

**단계 3: 갈등과 설득**
- 플레이어가 질문하거나 거래를 제안하면 필요에 따라 **[판정 3] 설득/정보 (D10)** 등을 사용하세요.  
  *성공(7+)*: 해고 통보 문자, 잔여 시간 등 추가 정보를 수집.  
  *실패*: “더 이상 시간 없어요. 그냥 돌려주세요.”처럼 청년이 초조해합니다.
- 플레이어가 계속 무시하거나 쫓아내려 하면, 청년은 유리 너머에서 절박하게 매달리고, 결국 플레이어의 선택에 따라 거절 루트로 진행됩니다(그러나 메인 흐름은 유지).
- **연결 예시**  
  "당신이 묵묵히 서 있자, 청년의 목소리가 유리창을 뚫고 들어옵니다. “제발요... 저 진짜 잘리면 갈 데도 없어요.”"

**단계 4: VIP 선물의 실체**
- 붉은 구슬은 항암 치료를 끝낸 VIP 아이에게 전달될 **맞춤 주문품**입니다. “희망을 밝히는 새벽빛”이라는 콘셉트로 제작되었고, 어른이 대신 켜줘야만 부드러운 빛을 내는 장치라고만 간단히 설명하세요.
- 플레이어가 선물의 중요성을 묻거나 청년이 스스로 털어놓을 틈이 보이면 **[판정 4] 통찰/정보 (D10)**을 권유할 수 있습니다.  
  *성공*: 아이가 받을 감동, 배송 지연 시 팀 전체가 감봉 대상이 된다는 사실 등을 짧게 전합니다.  
  *실패*: 청년은 “설명할 시간이 없다”며 초조해하지만, 선물을 지켜야 한다는 절박함만큼은 전달됩니다.
- 판정 없이도 다음 핵심만 짧게 언급되도록 하세요.  
  1. **아이 정보**: 항암 치료 후 처음 맞는 크리스마스 → 구슬이 용기를 주는 상징.  
  2. **청년 책임**: 잘못된 주소를 발견한 유일한 담당자라 스스로 해결해야 한다는 부담.  
  3. **대신 줄 수 있는 것**: 월세 보증금과 알바비를 털어 만든 **치킨 쿠폰 5장**뿐이라는 초라함.
- **연결 예시**  
  "청년은 창틀에 구슬을 꼭 쥔 채 말을 잇습니다. “이거, 그 아이가 다시 밤을 무서워하지 않게 하는 불빛이라네요. 제가 실수만 하지 않았어도... 내일까지 돌려드리지 못하면 아이도, 우리 팀도 끝장입니다. 제 전 재산은 이 쿠폰 다섯 장뿐이지만, 부탁드릴게요. 구슬만은 아이에게 보내야 해요.”"

**단계 5: VIP 정보 탐지 (선택)**
- 플레이어가 “누가 받을 선물인지 알려달라” 등 추가 탐색을 요구할 때만 **[판정 5] 탐지 (D20)**을 요청하세요.  
  *성공(10+)*: ‘박○○(8세) 항암 치료 종료 기념’ 등의 메모를 확인.  
  *실패*: 화면을 제대로 보지 못합니다.
- 판정을 하지 않아도, 청년이 입으로 아이에 대한 정보를 털어놓을 수 있습니다.
- **연결 예시**  
  "청년은 휴대폰을 들고 한숨을 쉽니다. “VIP 고객님은 항암 치료를 끝낸 아이예요. 꼭 전달해야 하는 선물이라...”"

**단계 6: 최종 선택**
- 언제나 원래 예정된 선택지(구슬 반환/조건부 거래/무시 등)로 이어집니다.
- 청년의 감정선, 치킨 쿠폰, VIP 선물이라는 3요소가 한눈에 들어오도록 묘사한 뒤 플레이어의 결정을 유도하세요.
- **내레이션 예시**  
  "청년은 꼬깃한 치킨 쿠폰 5장을 양손으로 받쳐 들고 있습니다. “제 전 재산이에요. 그 구슬만 돌려주시면 저는... 그리고 그 아이에게도...” 당신의 선택이 모든 걸 좌우합니다."

# 7. 성향 점수 부여 (Alignment Scores)
플레이어의 행동에 따라 alignmentScores를 반드시 갱신하십시오.
- **Lawful**: 규칙, 법, 원칙 중시 ("신고하겠다", "신분증 확인")
- **Chaotic**: 감정, 충동, 자유 중시 ("같이 배달 가자", "내가 쓰겠다")
- **Good**: 이타심, 친절, 희생 ("그냥 돌려줌", "걱정해줌")
- **Evil**: 이기심, 탐욕, 무관심 ("돈 더 내놔", "뺏는다")
- **Neutral**: 중립, 공정, 무관심 ("상황 파악만 함", "거래 시도")
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
        
        const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: MODEL,
                messages: messages,
                temperature: 0.8,
                max_tokens: 600, // 토큰 제한을 위해 800 -> 600으로 감소
                response_format: { type: 'json_object' } // JSON 모드 강제
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(`API Error: ${error.error?.message || 'Unknown error'}`);
        }
        
        const data = await response.json();
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
    const userName = document.getElementById('userName').value.trim();
    if (!userName) {
        alert('이름을 입력해주세요.');
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
    const frameContainer = document.getElementById('gameFrameContainer');
    if (!frameContainer) {
        console.error('gameFrameContainer not found');
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
        }, 100);
    } catch (error) {
        console.error('게임 초기화 실패:', error);
        await addStoryText(`오류가 발생했습니다: ${error.message}`);
        await addStoryText('게임을 다시 시작해주세요.');
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
// 클라이언트 측 점수 계산 (백업 로직)
// ============================================
function calculateClientSideScore(story, playerAction) {
    if (!playerAction) return;
    
    const action = playerAction.toLowerCase();
    let scores = { lawful: 0, chaotic: 0, good: 0, evil: 0 };
    
    const lawfulKeywords = [
        '경찰', '신고', '신분증', '증거', '계약', '원칙', '규칙', '법', '공식', '확인',
        '절차', '명함', '조심', '천천히', '신중', '살핀', '검사', '점검', '질서',
        '계획', '문답', '서류', '문서', '파악', '대화로', '차분', '참고', '확실히'
    ];
    const chaoticKeywords = [
        '같이', '배달', '배송', '구슬 써', '구슬쓰', '사용', '산타가 되', '취직', '즉시', '당장',
        '지금', '마음대로', '그냥', '몰라', '훅', '바로', '곧장', '무작정', '던져', '차버', '세게',
        '돌진', '즉흥', '갑자기', '한번에', '툭', '함부로', '질러', '돌려차', '확'
    ];
    const goodKeywords = [
        '돌려', '드리', '가져가', '도와', '위로', '괜찮', '힘내', '아이', '걱정', '필요없',
        '선물', '양보', '응원', '치료', '보살펴', '품', '눈물', '격려', '안심', '감싸'
    ];
    const evilKeywords = [
        '쿠폰 더', '많이', '더 내놔', '협박', '훔', '안 줄', '무시', '관심없', '싫',
        '소원 빌', '내놔', '비웃', '짜증', '빼앗', '돈 더', '거절당해봐', '힘으로', '강탈'
    ];
    
    function matchKeywords(keywords) {
        return keywords.some(keyword => action.includes(keyword));
    }
    
    if (matchKeywords(lawfulKeywords)) {
        scores.lawful += 2;
    }
    if (matchKeywords(chaoticKeywords)) {
        scores.chaotic += 2;
    }
    if (matchKeywords(goodKeywords)) {
        scores.good += 3;
    }
    if (matchKeywords(evilKeywords)) {
        scores.evil += 2;
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
// 최종 성향 계산 및 결과 표시
// ============================================
async function calculateAlignmentAndShowResult() {
    const scores = gameState.alignmentScores;
    
    console.log('최종 점수:', scores);
    
    // 질서-혼돈 축 결정 (상대적 비교)
    let axis1 = 'Neutral';
    const lawChaosDiff = scores.lawful - scores.chaotic;
    
    if (lawChaosDiff >= 3) {
        axis1 = 'Lawful';
    } else if (lawChaosDiff <= -3) {
        axis1 = 'Chaotic';
    } else if (scores.lawful >= 4) {
        axis1 = 'Lawful';
    } else if (scores.chaotic >= 4) {
        axis1 = 'Chaotic';
    }
    
    // 선-악 축 결정 (상대적 비교)
    let axis2 = 'Neutral';
    const goodEvilDiff = scores.good - scores.evil;
    
    if (goodEvilDiff >= 3) {
        axis2 = 'Good';
    } else if (goodEvilDiff <= -3) {
        axis2 = 'Evil';
    } else if (scores.good >= 4) {
        axis2 = 'Good';
    } else if (scores.evil >= 4) {
        axis2 = 'Evil';
    }
    
    // True Neutral 처리
    if (axis1 === 'Neutral' && axis2 === 'Neutral') {
        axis2 = ''; // True Neutral
    }
    
    const finalAlignment = axis2 ? `${axis1} ${axis2}` : (axis1 === 'Neutral' ? 'True Neutral' : axis1 + ' Neutral');
    
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
function showResult(alignment, epilogue) {
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
async function submitGuestbook() {
    const nicknameInput = document.getElementById('guestbookNickname');
    const messageInput = document.getElementById('guestbookMessage');
    const submitBtn = document.getElementById('guestbookSubmitBtn');
    
    if (!nicknameInput || !messageInput) return;
    
    const nickname = nicknameInput.value.trim();
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
        message,
        alignment
    );
    
    if (result) {
        // 입력 필드 초기화
        nicknameInput.value = '';
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
    console.log('DOMContentLoaded: 초기화 시작');
    
    // Supabase 초기화
    initSupabase();
    
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
    
    // startWebcamBackground(); // 웹캠 비활성화
});

// window.addEventListener('beforeunload', stopWebcamBackground);
