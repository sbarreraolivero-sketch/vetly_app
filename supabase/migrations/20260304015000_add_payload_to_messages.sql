-- Migration: add_payload_to_messages

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb;
