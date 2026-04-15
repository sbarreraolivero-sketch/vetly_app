-- FIX: Missing columns in messages table causing WhatsApp Agent failure

-- 1. Add payload column to messages table
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb;

-- 2. Ensure other required columns for AI processing and deduplication are present
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS ycloud_message_id TEXT,
ADD COLUMN IF NOT EXISTS message_type TEXT,
ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ai_function_called TEXT,
ADD COLUMN IF NOT EXISTS ai_function_result JSONB;

-- 3. Create indexes for performance and deduplication lookups
CREATE INDEX IF NOT EXISTS idx_messages_ycloud_id ON public.messages(ycloud_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_clinic_phone ON public.messages(clinic_id, phone_number);

-- 4. Verify the change by selecting columns (this won't error if successful)
SELECT id, phone_number, content, payload, ycloud_message_id 
FROM public.messages 
LIMIT 1;
