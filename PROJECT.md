# CampusRadar

## 1. Project Overview

CampusRadar is a personalized career-event discovery system for college students.

College campuses host a large number of career-related events, including:

- Company information sessions
- Recruiting events
- Technical workshops
- Tech talks
- Interview preparation sessions
- Networking events
- Career fairs
- Coffee chats
- Employer presentations
- Student-organization events involving employers

The problem is that information about these events is fragmented across many different sources.

Students may need to repeatedly check department calendars, career-service websites, university event calendars, student organizations, employer pages, and other campus platforms.

This makes discovering relevant opportunities time-consuming and unreliable. Students may spend significant time searching for events or miss valuable opportunities entirely.

CampusRadar solves this by automatically discovering career-related campus events, determining which events are relevant to each student, and proactively notifying them.


## 2. Core Product Idea

CampusRadar should work in the background for the student.

Instead of requiring students to repeatedly search for events, the system periodically monitors supported campus event sources.

When a new event is discovered, CampusRadar:

1. Extracts and normalizes the event information.
2. Determines whether the event is relevant to a particular student.
3. Generates a short explanation of why the event may be useful.
4. Emails the student about the event.
5. Allows the student to provide feedback.
6. Allows the student to add the event to their Google Calendar.

The goal is:

> Relevant career opportunities should find the student instead of the student constantly searching for them.


## 3. Initial Scope

The initial version of CampusRadar will support:

**University of Illinois Urbana-Champaign (UIUC)**

The architecture should make supporting additional universities possible in the future, but multi-university support is NOT part of the initial product.

Do not introduce unnecessary abstractions solely for hypothetical future universities.


## 4. Target User

The initial target user is a college student looking for career-related opportunities on campus.

A user profile may contain information such as:

- Major
- Graduation year
- Career interests
- Roles of interest
- Industries/domains of interest
- Companies of interest
- Keywords/topics of interest
- Interests the student does NOT want to see

Example:

Major:
Computer Engineering

Career interests:
- Software Engineering
- Systems / Infrastructure
- Fintech

Event interests:
- Recruiting events
- Technical workshops
- Tech talks
- Interview preparation
- Networking with engineers/recruiters

The exact profile schema should evolve based on product requirements rather than being over-engineered upfront.


## 5. Core User Experience

### Step 1 — Create Profile

The student creates a profile describing their academic background and career interests.

Example:

Major: Computer Engineering

Interested in:
- Software Engineering
- Fintech
- Systems
- Infrastructure

Not interested in:
- Accounting
- Marketing
- Sales


### Step 2 — Event Discovery

CampusRadar periodically checks supported public campus sources for new career-related events.

Potential source categories include:

- University event calendars
- Department calendars
- Career-service websites
- Engineering/CS career pages
- Public student-organization event pages
- Public employer recruiting events

Sources must be evaluated individually.

Prefer structured feeds, APIs, or official calendar data when available.

Do not scrape websites unnecessarily.


### Step 3 — Normalize Events

Events from different sources should be converted into a common internal event representation.

Typical event information includes:

- Title
- Company/organization
- Description
- Event category
- Start time
- End time
- Timezone
- Location
- Registration URL
- Original source URL
- Source
- Discovery timestamp

The original source must always be preserved.


### Step 4 — Deduplicate

The same event may appear on multiple campus websites.

CampusRadar should attempt to recognize duplicate events rather than showing or notifying the user about the same event multiple times.

Deduplication may eventually consider:

- Source IDs
- Event title
- Company
- Date
- Start time
- Location
- Normalized text
- Fuzzy similarity

Start with deterministic approaches before introducing unnecessary complexity.


### Step 5 — Determine Relevance

CampusRadar evaluates each newly discovered event against the student's profile.

The system should produce a relevance result that is understandable rather than an unexplained score.

Example:

Event:
Google Interview Prep Workshop

Potential reasons:

- User is interested in Software Engineering.
- Event is related to technical interview preparation.
- User is interested in software internships.

The initial relevance system should favor simple and explainable rules.

Do NOT introduce machine learning simply for the sake of using machine learning.


### Step 6 — Notify the Student

When CampusRadar discovers a sufficiently relevant new event, it sends the student an email.

Example:

---

Google Interview Prep Workshop

September 23
6:00 PM
Siebel Center

Why CampusRadar recommended this:

You're interested in software engineering opportunities, and this workshop focuses on technical interview preparation that may be useful for software internship recruiting.

[Interested]

[Not Interested]

[Already Going]

[Add to Calendar]

[View Event]

---

The notification should be concise and useful.

CampusRadar should avoid overwhelming users with low-quality notifications.


## 6. User Feedback

For recommended events, users should be able to indicate:

- Interested
- Not Interested
- Already Going

The system should store this feedback.

Initially, this feedback may simply be recorded.

Later versions may use historical feedback to improve personalization.

For example, if a user repeatedly marks technical workshops as "Interested" but generic career fairs as "Not Interested," CampusRadar may eventually use this behavior when ranking future events.

Behavioral personalization is a future enhancement and should NOT complicate the initial implementation.


## 7. Google Calendar Integration

Users should be able to connect their Google Calendar.

For an event, the user should be able to choose:

**Add to Calendar**

CampusRadar should create a calendar event containing relevant information such as:

- Event title
- Start time
- End time
- Location
- Description
- Registration URL
- Source URL

The system must prevent duplicate calendar events.

If CampusRadar stores an event in Google Calendar, it should retain the Google Calendar event identifier when appropriate so that the existing calendar event can be updated rather than duplicated.

Automatic calendar insertion may be added later as an optional user-controlled feature.

The initial experience should require explicit user action.


## 8. Website

Email is the primary proactive notification mechanism, but CampusRadar should also provide a web application.

The website acts as the user's control center.

Potential sections include:

### For You

Events CampusRadar believes are relevant to the student.

### Upcoming

Upcoming discovered events.

### Interested

Events the student has marked as interested.

### Going

Events the student has marked as already going.

### Ignored

Events the student has marked as not interested.

### Settings / Preferences

Allows the student to manage:

- Major
- Graduation year
- Career interests
- Industries
- Roles
- Companies
- Keywords
- Notification preferences
- Calendar integration


## 9. Core Product Loop

The fundamental CampusRadar loop is:

Sources
→ Discover Events
→ Normalize
→ Deduplicate
→ Store
→ Match Against User Profile
→ Determine Relevance
→ Notify User
→ Receive Feedback
→ Calendar Action

The most important product behavior is proactive discovery.

CampusRadar should reduce the amount of manual searching a student needs to perform.


## 10. MVP Definition

The MVP is successful when the following workflow works end-to-end:

1. A student creates an account.
2. The student creates a career-interest profile.
3. CampusRadar monitors a small number of real UIUC event sources.
4. CampusRadar discovers a new career-related event.
5. The event is stored in the database.
6. Duplicate events are avoided.
7. CampusRadar evaluates the event against the student's profile.
8. A relevant event triggers an email notification.
9. The email explains briefly why the event was recommended.
10. The student can mark:
    - Interested
    - Not Interested
    - Already Going
11. The student's response is stored.
12. The student can add the event to Google Calendar.
13. The website shows the student's relevant upcoming events.

The most important real-world success test is:

> Can CampusRadar discover a relevant campus career event and tell the student about it before they would otherwise have found it themselves?


## 11. Out of Scope for MVP

Do NOT implement these unless the project requirements are explicitly changed:

- Multiple universities
- Native iOS application
- Native Android application
- Employer accounts
- Employer event submission
- Social networking
- Student-to-student messaging
- Resume analysis
- Job application tracking
- Job listings
- Complex machine-learning recommendation models
- AI chatbot
- Automatic application submission
- Outlook Calendar integration
- Paid subscriptions
- Advanced analytics

Avoid feature creep.


## 12. Initial Technology Stack

The planned stack is:

### Language

TypeScript

### Web Application

Next.js
React

### Styling

Tailwind CSS

### Database

PostgreSQL

### Database / Backend Platform

Supabase

### Hosting

Vercel

### Authentication

Supabase Auth or another appropriate authentication solution if architectural investigation identifies a strong reason to use something else.

### Calendar

Google Calendar API

### Email

Resend

### Source Control

Git
GitHub

These choices should remain stable unless there is a concrete technical reason to change them.


## 13. High-Level Architecture

The expected architecture is approximately:

Public Campus Sources
        |
        v
Event Collectors
        |
        v
Normalization
        |
        v
Deduplication
        |
        v
PostgreSQL
        |
        +-------------------+
        |                   |
        v                   v
Relevance Engine       Web Application
        |
        v
Notification System
        |
        +-------------------+
        |                   |
        v                   v
      Email          Google Calendar


This is a conceptual architecture.

Implementation details should be determined incrementally as the system is built.


## 14. Engineering Principles

### Real Data

Do not fabricate production event data.

Mock data is acceptable in automated tests and isolated development fixtures when clearly identified as such.

Production functionality should operate on real event information.


### Preserve Sources

Every discovered event must retain enough information to identify where it came from.

The original source URL should be preserved whenever available.


### Prefer Structured Data

When collecting events, prefer:

1. Official APIs
2. Official structured feeds
3. ICS/calendar feeds
4. Structured page data
5. HTML parsing

Do not scrape a website when a reliable structured source exists.


### Respect Source Restrictions

Do not bypass authentication, access controls, CAPTCHAs, rate limits, or other technical restrictions.

Collectors should operate only on sources that can appropriately be accessed.


### Deduplication

Do not create duplicate database events when the same event is encountered repeatedly.

Collectors should be safe to run multiple times.


### Calendar Safety

Do not create duplicate Google Calendar events.

Calendar operations should be idempotent where practical.


### Explainable Recommendations

A user should be able to understand why an event was recommended.

Avoid opaque relevance scores without supporting reasons.


### User Control

The user controls:

- Interests
- Feedback
- Notification preferences
- Calendar actions

Do not automatically place events on a user's calendar in the MVP.


### Secrets

Never commit:

- API keys
- OAuth secrets
- Database credentials
- Access tokens
- Refresh tokens
- Private keys

Use environment variables and appropriate secret-management mechanisms.


### Error Handling

Do not silently swallow errors.

Important collector, database, notification, and integration failures should be logged and handled appropriately.


### Scope Discipline

When implementing a feature:

- Do not rewrite unrelated functionality.
- Do not introduce unnecessary dependencies.
- Do not perform unrelated refactors.
- Prefer the smallest correct implementation.
- Avoid premature abstraction.


## 15. Testing Principles

Important functionality should be testable.

Particular attention should eventually be given to:

- Event parsing
- Event normalization
- Deduplication
- Relevance rules
- User feedback
- Calendar duplicate prevention
- Collector idempotency

A collector should be independently testable using saved fixtures when appropriate.

After meaningful implementation changes, run the project's available:

- Type checking
- Linting
- Automated tests
- Production build

Do not claim functionality works solely because the code appears correct.


## 16. Development Philosophy

CampusRadar should be built incrementally.

Preferred development loop:

Plan
→ Implement one bounded capability
→ Test
→ Manually verify
→ Commit
→ Continue

The application should remain in a working state after each major milestone.

Do not attempt to build the entire product in one implementation step.


## 17. Initial Development Order

The expected order is approximately:

### Phase 1 — Foundation

- Initialize application
- Establish database connection
- Define initial event data model
- Display stored events

### Phase 2 — Event Discovery

- Investigate first UIUC source
- Implement first collector
- Normalize events
- Persist events
- Make collection idempotent
- Implement basic deduplication
- Add additional sources incrementally

### Phase 3 — Users and Personalization

- Authentication
- User profile
- Career preferences
- Initial relevance rules
- Recommendation explanations
- Event feedback

### Phase 4 — Notifications

- Email integration
- Detect newly discovered relevant events
- Send useful notifications
- Prevent duplicate notifications

### Phase 5 — Calendar

- Google OAuth
- Google Calendar connection
- Add event to Calendar
- Prevent duplicate calendar events
- Store calendar event identifiers

### Phase 6 — Automation

- Scheduled collection
- Reliable event-change detection
- Notification scheduling
- Failure handling

### Phase 7 — Production Quality

- Logging
- Monitoring
- Error handling
- Security review
- Testing
- Performance improvements
- Deployment hardening


## 18. Instructions for Coding Agents

Before making substantial changes:

1. Read this file.
2. Inspect the existing repository.
3. Understand the current implementation.
4. Identify which part of the roadmap is currently being worked on.

When asked to implement a feature:

1. Investigate the relevant existing code first.
2. State the proposed implementation plan when requested.
3. Prefer the smallest correct solution.
4. Do not modify unrelated functionality.
5. Do not invent requirements.
6. Do not add features simply because they seem useful.
7. Preserve existing working behavior.
8. Add or update tests when appropriate.
9. Run available validation commands.
10. Report failures honestly.

If requirements are genuinely ambiguous and the decision could significantly affect architecture or product behavior, ask for clarification rather than silently making a major assumption.


## 19. Product Principle

CampusRadar exists because students should not need to continuously search numerous websites to discover valuable career opportunities happening around them.

The product should make career-event discovery:

- Proactive
- Personalized
- Explainable
- Low effort
- Reliable

The guiding principle is:

> The right opportunity should find the student.