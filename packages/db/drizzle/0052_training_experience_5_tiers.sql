-- 0052_training_experience_5_tiers.sql
--
-- Expand training_experience from 3 to 5 tiers.
--
-- Old values (lt_1y, 1_3y, gte_3y) backfilled to closest new values:
--   lt_1y  → novice_6m_2y         (a "<1y" user is more likely 6m-1y novice than first-week beginner)
--   1_3y   → intermediate_2y_5y   (1-3y -> 2-5y bucket as closest)
--   gte_3y → advanced_5y_10y      (3+y -> the closest mid-tier on the new scale)
--
-- Users whose self-classification is wrong after the backfill can fix
-- it from /app/settings — the picker shows all 5 new options.

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_training_experience_check;

UPDATE profiles SET training_experience = 'novice_6m_2y'        WHERE training_experience = 'lt_1y';
UPDATE profiles SET training_experience = 'intermediate_2y_5y'  WHERE training_experience = '1_3y';
UPDATE profiles SET training_experience = 'advanced_5y_10y'     WHERE training_experience = 'gte_3y';

ALTER TABLE profiles
  ADD CONSTRAINT profiles_training_experience_check
  CHECK (training_experience IS NULL OR training_experience IN (
    'beginner_lt_6m',
    'novice_6m_2y',
    'intermediate_2y_5y',
    'advanced_5y_10y',
    'highly_advanced_10y_plus'
  ));
