-- DEVELOPMENT SEED DATA ONLY.
-- These are fake example events for testing the database connection.
-- They are not real UIUC campus listings.
--
-- Safe to run more than once: duplicate source_url rows are skipped.

insert into public.events (
  title,
  company,
  description,
  category,
  start_time,
  end_time,
  timezone,
  location,
  registration_url,
  source_url,
  source,
  external_id,
  discovered_at
) values
  (
    'Google Interview Prep Workshop',
    'Google',
    'Mock workshop covering coding-interview practice for software internship recruiting.',
    'Interview preparation',
    timestamptz '2026-09-23 18:00:00 America/Chicago',
    timestamptz '2026-09-23 19:30:00 America/Chicago',
    'America/Chicago',
    'Siebel Center, Room 2405',
    'https://example.com/mock/google-interview-prep',
    'https://example.com/mock/sources/google-interview-prep',
    'Mock UIUC Engineering Calendar',
    'seed:google-interview-prep',
    timestamptz '2026-09-19 12:00:00 America/Chicago'
  ),
  (
    'Jane Street Tech Talk: Systems at Scale',
    'Jane Street',
    'Mock tech talk about infrastructure and systems work in a trading environment.',
    'Tech talk',
    timestamptz '2026-09-24 17:00:00 America/Chicago',
    timestamptz '2026-09-24 18:00:00 America/Chicago',
    'America/Chicago',
    'ECE Building, Room 1002',
    'https://example.com/mock/jane-street-tech-talk',
    'https://example.com/mock/sources/jane-street-tech-talk',
    'Mock CS Department Events',
    'seed:jane-street-tech-talk',
    timestamptz '2026-09-19 12:05:00 America/Chicago'
  ),
  (
    'Capital One Software Engineering Info Session',
    'Capital One',
    'Mock recruiting session for students interested in software engineering internships in fintech.',
    'Company information session',
    timestamptz '2026-09-25 12:00:00 America/Chicago',
    timestamptz '2026-09-25 13:00:00 America/Chicago',
    'America/Chicago',
    'Grainger Library, Room 329',
    'https://example.com/mock/capital-one-info-session',
    'https://example.com/mock/sources/capital-one-info-session',
    'Mock Engineering Career Services',
    'seed:capital-one-info-session',
    timestamptz '2026-09-19 12:10:00 America/Chicago'
  )
on conflict (source_url) do nothing;
