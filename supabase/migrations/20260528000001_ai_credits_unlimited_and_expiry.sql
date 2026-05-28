-- Migration: AI Credits Unlimited flag + Expiry + metadata column
-- Adds ai_credits_unlimited, ai_credits_extra_expires_at to clinic_settings
-- Adds metadata JSONB column to ai_credit_transactions

-- 1. New columns in clinic_settings
ALTER TABLE public.clinic_settings
    ADD COLUMN IF NOT EXISTS ai_credits_unlimited BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS ai_credits_extra_expires_at TIMESTAMPTZ DEFAULT NULL;

-- 2. metadata column in ai_credit_transactions (needed for model/source tracking)
ALTER TABLE public.ai_credit_transactions
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;
