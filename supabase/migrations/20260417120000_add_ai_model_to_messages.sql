-- Add ai_model to messages table to correctly track credit usage
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS ai_model TEXT DEFAULT 'mini';
