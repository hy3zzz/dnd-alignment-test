-- ============================================
-- Supabase 테이블 생성 SQL
-- ============================================
-- 이 SQL을 Supabase Dashboard > SQL Editor에서 실행하세요.

-- 1. game_sessions 테이블 - 게임 세션 정보
CREATE TABLE IF NOT EXISTS game_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    player_name TEXT NOT NULL,
    alignment TEXT,
    alignment_scores JSONB DEFAULT '{"lawful": 0, "chaotic": 0, "good": 0, "evil": 0}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- 2. conversation_logs 테이블 - 대화 로그 (AI 응답, 유저 응답, 타임스탬프)
CREATE TABLE IF NOT EXISTS conversation_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID REFERENCES game_sessions(id) ON DELETE CASCADE,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. guestbook 테이블 - 방명록
CREATE TABLE IF NOT EXISTS guestbook (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID REFERENCES game_sessions(id) ON DELETE SET NULL,
    nickname TEXT NOT NULL,
    message TEXT NOT NULL,
    alignment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 인덱스 생성 (성능 최적화)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_conversation_logs_session_id ON conversation_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_conversation_logs_timestamp ON conversation_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_guestbook_created_at ON guestbook(created_at DESC);

-- ============================================
-- Row Level Security (RLS) 설정
-- ============================================
-- RLS 활성화
ALTER TABLE game_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE guestbook ENABLE ROW LEVEL SECURITY;

-- 모든 사용자가 읽기/쓰기 가능 (익명 사용자 포함)
-- game_sessions
CREATE POLICY "Allow all operations on game_sessions" ON game_sessions
    FOR ALL USING (true) WITH CHECK (true);

-- conversation_logs
CREATE POLICY "Allow all operations on conversation_logs" ON conversation_logs
    FOR ALL USING (true) WITH CHECK (true);

-- guestbook
CREATE POLICY "Allow all operations on guestbook" ON guestbook
    FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- 샘플 데이터 (테스트용, 필요시 사용)
-- ============================================
-- INSERT INTO guestbook (nickname, message, alignment)
-- VALUES ('테스트유저', '재미있는 테스트였어요!', 'Lawful Good');

