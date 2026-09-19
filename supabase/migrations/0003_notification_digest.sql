-- Digest delivery state for the push dispatcher.
--
-- notification_prefs.digest has always offered instant/daily/weekly, but the
-- dispatcher had no way to know when a user last received a batched digest, so
-- it sent everything instantly. This adds the bookmark it needs.

alter table public.notification_prefs
  add column if not exists digest_sent_at timestamptz;

comment on column public.notification_prefs.digest_sent_at is
  'When the last batched digest went out. Null means one is due immediately. Unused when digest = instant.';

-- A brand-new subscriber should hear about the next move straight away rather
-- than waiting up to a day for the first digest window.
alter table public.notification_prefs
  alter column digest set default 'instant';
